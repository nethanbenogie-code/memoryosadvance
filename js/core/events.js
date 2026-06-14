/**
 * MemoryOS — core/events.js
 *
 * A tiny in-process publish/subscribe bus.
 *
 * Architectural role: this is the seam that keeps MemoryOS extensible
 * without rewrites. In v0.1 the only subscribers are UI views refreshing
 * themselves. In v0.3 the AI assistant subscribes to the very same
 * events ("memory:created", "task:completed") to build its context.
 * Nothing upstream has to change.
 *
 * Event names used in v0.1:
 *   memory:created   { memory }
 *   memory:updated   { memory }
 *   memory:deleted   { id }
 *   view:changed     { view }
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {(payload: any) => void} handler
   * @returns {() => void} Unsubscribe function.
   */
  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe a handler.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    this._handlers.get(event)?.delete(handler);
  }

  /**
   * Publish an event. Handler errors are isolated so one broken
   * subscriber can never take down the others.
   * @param {string} event
   * @param {any} [payload]
   */
  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[events] handler for "${event}" failed:`, err);
      }
    }
  }
}

/** The application-wide bus instance. */
export const bus = new EventBus();
