import { BehaviorSubject, concatMap, filter, from, Observable, pipe, share, Subject, takeUntil, UnaryFunction, withLatestFrom } from "rxjs"
import { Persistable, Persistence } from "@taterer/persist"

export interface Meta {
  entity: string
  eventType: string
}

/**
 * EntityEventHandlers should handle every type of entity event, and all of these event handlers should be as pure as possible (no side effects; ID/time may make it less than deterministic).
 */
export type EntityEventHandlers<Entity, EntityEventType extends string> = {
  [key in EntityEventType]: (entity: Entity, event: any) => Entity
}

/**
 * SideEventHandlers should handle any entity event which needs to reach beyond the scope of the entity domain (EG: emitting events to another domain)
 */
export type SideEventHandlers<Entity, EntityEventType extends string> = {
  [key in EntityEventType]?: (originalEntity: Entity, event: any, updatedEntity: Entity) => Entity
}

export function subjectFactory<T> (defaultValue?: T): [Observable<T>, (event: T) => void] {
  const subject$ = defaultValue ? new BehaviorSubject<T>(defaultValue) : new Subject<T>()

  function addEvent (event: T) {
    subject$.next(event)
  }

  return [
    subject$.asObservable(),
    addEvent
  ]
}

export function addMeta<T> (event: T, meta: Meta) {
  return { ...event, meta }
}

export function eventFactory<T> (meta: Meta, defaultValue?: T & { meta: Meta }): [Observable<T & { meta: Meta }>, (event: T) => void] {
  const subject$ = defaultValue ? new BehaviorSubject<T & { meta: Meta }>(defaultValue) : new Subject<T & { meta: Meta }>()

  function addEvent (event: T) {
    subject$.next(addMeta(event, meta))
  }

  return [
    subject$.asObservable(),
    addEvent,
  ]
}

/**
 * Checkout an entity from persistence, use the corresponding event and side handler to handle the given entity event, then persist.
 * @param persistence Form of persistence
 * @param entityPersistence The persistence type of the entity
 * @param eventHandlers Object map with handlers for each entity event
 * @param event Entity event to be handled
 * @param sideHandlers Object map with handlers for coordinating beyond the scope of the entity (other entities/services)
 * @returns 
 */
 export async function entityEventHandler<EventType extends { id: string, meta: Meta }, EntityType, PersistenceEntityType> (
  persistence: Persistence<EntityType, PersistenceEntityType>,
  entityPersistence: PersistenceEntityType,
  eventHandlers: { [key: string]: (entity: EntityType, event: EventType | [EventType, ...any]) => EntityType },
  event: EventType | [EventType, ...any],
  sideHandlers?: { [key: string]: (entity: EntityType, event: EventType | [EventType, ...any], updatedEntity: EntityType) => Promise<EntityType> | EntityType }
  ): Promise<EntityType & { meta: { entity: PersistenceEntityType, eventType }}> {
  const eventId = Array.isArray(event) ? event[0].id : event.id
  const eventType = Array.isArray(event) ? event[0].meta.eventType : event.meta.eventType
  let currentEntity
  try {
    currentEntity = await persistence.get(entityPersistence, eventId)
  } catch (err) {
    // continue if it's an add, otherwise throw
    if (eventType !== 'add') {
      throw err
    }
  }
  const updatedEntity = eventHandlers[eventType](currentEntity, event)
  let handledEntity = updatedEntity as EntityType & { id?: string, deleted?: boolean }
  if (sideHandlers && sideHandlers[eventType]) {
    handledEntity = await sideHandlers[eventType](currentEntity, event, updatedEntity)
  }
  if (handledEntity.deleted) {
    await persistence.remove(entityPersistence, { id: eventId })
  } else {
    if (!handledEntity.id) {
      throw new Error('Cannot save entity without an id. Consider putting id explicitly in the event handler.')
    }
    await persistence.put(entityPersistence, { id: handledEntity.id }, handledEntity)
  }
  return { ...handledEntity, meta: { entity: entityPersistence, eventType } }
}

/**
 * An entity service facilitates checking out a domain entity, modifying it, and checking it back in.
 * All modifications to a single domain object should go through a single entity OR aggregate service, to ensure all changes are captured.
 * @param persistence$ Observable form of persistence
 * @param entityPersistence The persistence type of the entity
 * @param eventHandlers Object map with handlers for each entity event
 * @param sideHandlers Object map with handlers for coordinating beyond the scope of the entity (other entities/services)
 * @returns OperatorFunction, events come in, updated entity comes out
 */
 export function entityServiceFactory<EntityType, PersistenceEntityType>(
  persistence$: Observable<Persistence<any & Persistable, PersistenceEntityType>>,
  entityPersistence: PersistenceEntityType,
  eventHandlers: { [key: string]: (entity: EntityType, event: any) => EntityType },
  sideHandlers?: { [key: string]: (entity: EntityType, event: any, updatedEntity: EntityType) => Promise<EntityType> | EntityType }
  ) {
  return pipe(
    withLatestFrom(persistence$),
    concatMap<[any, Persistence<any & Persistable, PersistenceEntityType>], Observable<EntityType & { meta: { entity: PersistenceEntityType, eventType }}>>(([event, persistence]) => {
      return from(entityEventHandler(persistence, entityPersistence, eventHandlers, event, sideHandlers))
    }),
    share()
  )
}

/**
 * Deduplicates events for the lifetime of the pipe
 * @returns OperatorFunction
 */
export function filterPreviouslySeenIds<T> (): UnaryFunction<Observable<T & Persistable>, Observable<T & Persistable>> {
  const map = new Map()
  return pipe(
    filter((event: T & Persistable) => {
      const hasId = map.has(event.id)
      if (hasId) {
        return false
      } else {
        map.set(event.id, true)
        return true
      }
    })
  )
}

/**
 * Subscribe to an array of observables, and apply the same destruction$ observable, and optional Map Function.
 * @param observables Observables to subscribe to
 * @param destruction$ Observable that will destroy created subscriptions on emission
 * @param mapFunction Optional function to use while creating subscriptions
 */
export function subscriptionFactory (observables: Observable<any>[], destruction$: Observable<any>, mapFunction?: (value: any) => void) {
  observables.forEach((obs) => {
    obs
    .pipe(takeUntil(destruction$))
    .subscribe(mapFunction)
  })
}
