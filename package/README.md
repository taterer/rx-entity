# Rx-Entity
An entity service framework.

## What does it do?
It allows you to create an engine to manage an entity. Rather than instantiating a class, it provides a pipeline that handles all events for an entity. Every time an event occurs, an entity is retrieved from persistence (see https://github.com/taterer/persist), and the appropriate event handler is invoked passing in the latest version of the entity as a parameter. The return from the event handler is then persisted, and will be used the next time an event for the entity is handled.

The service must have a subscription in the application for anything to actually happen (like all of RxJS).

## Recommendations
Each entity should be grouped with its corresponding commands, events, and queries. As opposed to grouping all entity commands together. Everything relating to the domain, should be within that domain folder (the UI is a separate concern, and should be organized however it makes sense - over in the ui part of the codebase).

It can be useful to start with an event storm. Define as many events as can easily be identified off the bat, and put them into a command.ts file. Then define as much as you can the data structure for those events, it is not critical to exhaust every option at this stage.

Next, move onto the event handlers. Create an event.ts file. Start with the domain entity itself, what is the resulting object that changes over time? With that interface defined, then create an EntityEventHandlers object, which will have a function to handle every command created previously. Each function should return a new entity with the desired updates. This is then wrapped into a service with your chosen persistence.

Last, create a query.ts file. This is where it can be useful to pull in a lot of entities (without changing them) to display to the user, or use in some other way. This step is not crucial, and can be done later, if ever.

The point of this engine is to isolate domain logic, and limit places for side effects. Persistence is managed within the service framework, but where should other side effects go? For aggregates, or api calls to other services, or to other domains. 

## Example
For an example output from an event storm, and event handlers. Checkout the example found at https://github.com/taterer/rx-entity