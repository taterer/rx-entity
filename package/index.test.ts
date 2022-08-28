import { firstValueFrom, from, Observable, shareReplay } from "rxjs"
import { SideEventHandlers, entityEventHandler, EntityEventHandlers, entityServiceFactory } from "."
import { Persistence } from "@taterer/persist"
import { memoryFactory } from "@taterer/persist-memory"

const MemoryEntity = {
  line: 'line',
  shape: 'shape'
}

describe('domainObject', () => {
  describe('given memoryDB with a calc table', () => {
    let memoryDB: Persistence<any, any>
    const memoryCalcTable = MemoryEntity.line // use an existing entity for the benefit of typescript
    const calcEntity = 'calc'

    beforeEach(async () => {
      memoryDB = await memoryFactory([
        {
          name: memoryCalcTable,
        },
      ])
    })

    describe('given a simple calculator domain', () => {
      const additionEventType = 'add'
      const eventHandlers = {
        [additionEventType]: (entity, event) => {
          return { ...entity, id: event.id, amount: (entity?.amount || 0) + event.amount }
        }
      }

      describe('when handling addition of 1+2', () => {
        let result
        const event1 = {
          id: 'test-1',
          amount: 1,
          meta: {
            entity: calcEntity,
            eventType: additionEventType
          }
        }
        const event2 = {
          id: 'test-1',
          amount: 2,
          meta: {
            entity: calcEntity,
            eventType: additionEventType
          }
        }

        beforeEach(async () => {
          await entityEventHandler(memoryDB, memoryCalcTable, eventHandlers, event1)
          result = await entityEventHandler(memoryDB, memoryCalcTable, eventHandlers, event2)
        })

        it('returns 3', () => {
          expect(result.amount).toBe(3)
        })
      })

      describe('given an entity service', () => {
        let entityService
        beforeEach(() => {
          entityService = entityServiceFactory(from([memoryDB]), memoryCalcTable, eventHandlers)
        })

        describe('when handling addition of 1+2', () => {
          let result
          const event1 = {
            id: 'test-1',
            amount: 3,
            meta: {
              entity: calcEntity,
              eventType: additionEventType
            }
          }
          const event2 = {
            id: 'test-1',
            amount: 4,
            meta: {
              entity: calcEntity,
              eventType: additionEventType
            }
          }

          beforeEach(() => {
            from([event1, event2])
            .pipe(entityService)
            .subscribe(i => result = i)
          })

          it('returns 7', () => {
            expect(result.amount).toBe(7)
          })
        })
      })
    })
  })

  describe('given memoryDB with a cart, and item tables', () => {
    let memoryDB$: Observable<Persistence<any, any>>
    const cart = MemoryEntity.shape // use an existing entity for the benefit of typescript
    const item = MemoryEntity.line // use an existing entity for the benefit of typescript
    
    beforeEach(async () => {
      memoryDB$ = from(memoryFactory([
        {
          name: cart,
        },
        {
          name: item,
        },
      ])).pipe(
        shareReplay(1)
      )

      memoryDB$.subscribe()
    })

    describe('given the item domain', () => {
      enum ItemEvent {
        setStock = 'setStock',
        decrementStock = 'decrementStock',
        changePrice = 'changePrice',
      }
      const itemEventHandlers: EntityEventHandlers<any, ItemEvent> = {
        [ItemEvent.setStock]: (entity, event) => {
          return { ...entity, id: event.id, name: event.name || entity.name, stock: event.stock }
        },
        [ItemEvent.decrementStock]: (entity, event) => {
          let stock = entity.stock - event.stock
          if (stock < 0) {
            stock = 0
          }
          return { ...entity, stock }
        },
        [ItemEvent.changePrice]: (entity, event) => {
          return { ...entity, ...event }
        },
      }

      describe('given a shopping cart domain', () => {
        enum CartEvent {
          addItem = 'addItem',
          removeItem = 'removeItem',
        }

        const cartEventHandlers: EntityEventHandlers<any, CartEvent> = {
          [CartEvent.addItem]: (entity, event) => {
            const items = [...entity?.items || []]
            const index = items.findIndex(i => i.id === event.item.id)
            if (index > -1) {
              items[index] = { ...items[index], quantity: items[index].quantity + event.item.quantity }
            } else {
              items.push(event.item)
            }
            return { ...entity, id: event.id, items }
          },
          [CartEvent.removeItem]: (entity) => {
            return { ...entity, deleted: true }
          }
        }

        const cartAggregateHandlers: SideEventHandlers<any, CartEvent> = {
          [CartEvent.addItem]: async (_, event, entity) => {
            const memoryDB = await firstValueFrom(memoryDB$)
            const itemEntity = await memoryDB.get(item, event.item.id)
            const cartItemsWithId = entity.items.filter(i => i.id === event.item.id)
            const quantity = cartItemsWithId.map(i => i.quantity).reduce((acc, current) => acc + current)

            if (quantity > itemEntity.stock) {
              throw new Error('Invalid stock')
            }
            return entity
          }
        }

        describe('given an aggregate service', () => {
          let itemService
          let cartService
          beforeEach(() => {
            itemService = entityServiceFactory(memoryDB$, item, itemEventHandlers)
            cartService = entityServiceFactory(memoryDB$, cart, cartEventHandlers, cartAggregateHandlers)
          })

          describe('given available items', () => {
            beforeEach(() => {
              const itemEvents = [
                {
                  id: 'sku1',
                  meta: {
                    entity: item,
                    eventType: ItemEvent.setStock
                  },
                  name: 'Something super interesting',
                  stock: 2,
                },
                {
                  id: 'sku2',
                  meta: {
                    entity: item,
                    eventType: ItemEvent.setStock
                  },
                  name: 'Boring stuff',
                  stock: 10,
                },
              ]
              from(itemEvents)
              .pipe(
                itemService
              )
              .subscribe()
            })

            describe('when adding an item to the cart within availability', () => {
              const errors: any[] = []
              let result
              beforeEach(async () => {
                from([
                  {
                    id: 'cart1',
                    meta: {
                      entity: cart,
                      eventType: CartEvent.addItem
                    },
                    item: {
                      id: 'sku1',
                      quantity: 2
                    }
                  }])
                  .pipe(
                    cartService,
                  )
                  .subscribe({
                    next: i => result = i,
                    error: (err) => errors.push(err)
                  })
              })

              it('runs without error', () => {
                expect(errors.length).toBe(0)
              })

              it('adds the item to the cart', () => {
                expect(result.items.length).toBe(1)
              })
            })

            describe('when adding an item to the cart with a quantity higher than the available stock', () => {
              const errors: any[] = []
              beforeEach(() => {
                from([
                  {
                    id: 'cart1',
                    meta: {
                      entity: cart,
                      eventType: CartEvent.addItem,
                    },
                    item: {
                      id: 'sku1',
                      quantity: 10
                    }
                  }
                ])
                .pipe(
                  cartService,
                )
                .subscribe({
                  error: async (err) => {
                    errors.push(err)
                  }
                })
              })

              it('rejects the update due to invalid stock', () => {
                expect(errors[0].message).toBe('Invalid stock')
              })
            })

            describe('given a cart with an item in it', () => {
              beforeEach(() => {
                const cartWithItemEvents = [
                  {
                    id: 'cart1',
                    meta: {
                      entity: cart,
                      eventType: CartEvent.addItem
                    },
                    item: {
                      id: 'sku1',
                      quantity: 1
                    }
                  }
                ]
                from(cartWithItemEvents)
                .pipe(
                  cartService
                )
                .subscribe()
              })
              
              describe('when adding an item to the cart within available stock', () => {
                const errors: any[] = []
                let result
                beforeEach(async () => {
                  from([
                    {
                      id: 'cart1',
                      meta: {
                        entity: cart,
                        eventType: CartEvent.addItem,
                      },
                      item: {
                        id: 'sku1',
                        quantity: 1
                      }
                    }
                  ])
                  .pipe(
                    cartService,
                  )
                  .subscribe({
                    next: i => result = i,
                    error: async (err) => {
                      errors.push(err)
                    }
                  })
                })

                it('runs without error', () => {
                  expect(errors.length).toBe(0)
                })

                it('increases the item quantity in the cart', () => {
                  expect(result.items[0].quantity).toBe(2)
                })
              })

              describe('when adding an item to the cart with a quantity higher than the available stock', () => {
                const errors: any[] = []
                let result
                beforeEach(async () => {
                  from([
                    {
                      id: 'cart1',
                      meta: {
                        entity: cart,
                        eventType: CartEvent.addItem,
                      },
                      item: {
                        id: 'sku1',
                        quantity: 10
                      }
                    }
                  ])
                  .pipe(
                    cartService,
                  )
                  .subscribe({
                    error: async (err) => {
                      errors.push(err)
                      const memoryDB = await firstValueFrom(memoryDB$)
                      result = await memoryDB.get(cart, 'cart1')
                    }
                  })
                })

                it('rejects the update due to invalid stock', () => {
                  expect(errors[0].message).toBe('Invalid stock')
                })

                it('does not add the item to the cart', () => {
                  expect(result.items[0].quantity).toBe(1)
                })
              })
            })
          })
        })
      })
    })
  })
})
