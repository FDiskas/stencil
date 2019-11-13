import * as d from '../declarations';
import { BUILD } from '@app-data';
import { consoleDevWarn, win } from '@platform';
import { EVENT_FLAGS } from '@utils';
import { getElement } from './element';


export const createEvent = (ref: d.RuntimeRef, name: string, flags: number) => {
  const elm = getElement(ref) as HTMLElement;
  return {
    emit: (detail: any) => {
      if (BUILD.isDev && !elm.isConnected) {
        consoleDevWarn(`The "${name}" event was emitted, but the dispatcher node is not longer connected to the dom.`);
      }
      return elm.dispatchEvent(
        new (BUILD.hydrateServerSide ? (win as any).CustomEvent : CustomEvent)(name, {
          bubbles: !!(flags & EVENT_FLAGS.Bubbles),
          composed: !!(flags & EVENT_FLAGS.Composed),
          cancelable: !!(flags & EVENT_FLAGS.Cancellable),
          detail
        })
      );
    }
  };
};
