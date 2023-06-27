import { Persistence } from '@taterer/persist';
import { memoryFactory } from '@taterer/persist-memory';
import { from, Observable, shareReplay } from 'rxjs';
import {
  entityEventHandler,
  EntityEventHandlers,
  entityServiceFactory,
} from '.';

const MemoryEntity = {
  line: 'line',
  shape: 'shape',
};

describe('domainObject', () => {
  describe('given memoryDB with a calc table', () => {
    let memoryDB: Persistence<any, any>;
    const memoryCalcTable = MemoryEntity.line; // use an existing entity for the benefit of typescript
    const calcEntity = 'calc';

    beforeEach(async () => {
      memoryDB = await memoryFactory([
        {
          name: memoryCalcTable,
        },
      ]);
    });

    describe('given a simple calculator domain', () => {
      const additionEventType = 'add';
      const eventHandlers = {
        [additionEventType]: (entity, event) => ({
          ...entity,
          id: event.id,
          amount: (entity?.amount || 0) + event.amount,
        }),
      };

      describe('when handling addition of 1+2', () => {
        let result;
        const event1 = {
          id: 'test-1',
          amount: 1,
          meta: {
            entity: calcEntity,
            eventType: additionEventType,
          },
        };
        const event2 = {
          id: 'test-1',
          amount: 2,
          meta: {
            entity: calcEntity,
            eventType: additionEventType,
          },
        };

        beforeEach(async () => {
          await entityEventHandler(
            memoryDB,
            memoryCalcTable,
            eventHandlers,
            event1,
          );
          result = await entityEventHandler(
            memoryDB,
            memoryCalcTable,
            eventHandlers,
            event2,
          );
        });

        it('returns 3', () => {
          expect(result.amount).toBe(3);
        });
      });

      describe('given an entity service', () => {
        let entityService;
        beforeEach(() => {
          entityService = entityServiceFactory(
            from([memoryDB]),
            memoryCalcTable,
            eventHandlers,
          );
        });

        describe('when handling addition of 1+2', () => {
          let result;
          const event1 = {
            id: 'test-1',
            amount: 3,
            meta: {
              entity: calcEntity,
              eventType: additionEventType,
            },
          };
          const event2 = {
            id: 'test-1',
            amount: 4,
            meta: {
              entity: calcEntity,
              eventType: additionEventType,
            },
          };

          beforeEach(() => {
            from([event1, event2])
              .pipe(entityService)
              .subscribe((i) => (result = i));
          });

          it('returns 7', () => {
            expect(result.amount).toBe(7);
          });
        });
      });
    });
  });

  describe('given memoryDB with a cart, and item tables', () => {
    let memoryDB$: Observable<Persistence<any, any>>;
    const cart = MemoryEntity.shape; // use an existing entity for the benefit of typescript
    const item = MemoryEntity.line; // use an existing entity for the benefit of typescript

    beforeEach(async () => {
      memoryDB$ = from(
        memoryFactory([
          {
            name: cart,
          },
          {
            name: item,
          },
        ]),
      ).pipe(shareReplay(1));

      memoryDB$.subscribe();
    });

    describe('given the item domain', () => {
      enum ItemEvent {
        changePrice = 'changePrice',
        decrementStock = 'decrementStock',
        setStock = 'setStock',
      }
      const itemEventHandlers: EntityEventHandlers<any, ItemEvent> = {
        [ItemEvent.setStock]: (entity, event) => ({
          ...entity,
          id: event.id,
          name: event.name || entity.name,
          stock: event.stock,
        }),
        [ItemEvent.decrementStock]: (entity, event) => {
          let stock = entity.stock - event.stock;
          if (stock < 0) {
            stock = 0;
          }
          return { ...entity, stock };
        },
        [ItemEvent.changePrice]: (entity, event) => ({ ...entity, ...event }),
      };

      describe('given a shopping cart domain', () => {
        enum CartEvent {
          addItem = 'addItem',
          removeItem = 'removeItem',
        }

        const cartEventHandlers: EntityEventHandlers<any, CartEvent> = {
          [CartEvent.addItem]: (entity, event) => {
            const items = [...(entity?.items || [])];
            const index = items.findIndex((i) => i.id === event.item.id);
            if (index > -1) {
              items[index] = {
                ...items[index],
                quantity: items[index].quantity + event.item.quantity,
              };
            } else {
              items.push(event.item);
            }
            return { ...entity, id: event.id, items };
          },
          [CartEvent.removeItem]: (entity) => ({ ...entity, deleted: true }),
        };
      });
    });
  });
});
