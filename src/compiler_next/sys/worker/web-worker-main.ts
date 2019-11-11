import * as d from '../../../declarations';
import { TASK_CANCELED_MSG, isString } from '@utils';
import { version } from '../../../version';


export const createWebWorkerMainController = (workerUrl: URL | string, workerName: string, maxConcurrentWorkers: number, events: d.BuildEvents): d.WorkerMainController => {
  let msgIds = 0;
  let isDestroyed = false;
  let isQueued = false;
  let workerIds = 0;
  const tasks = new Map<number, d.CompilerWorkerTask>();
  const queuedSendMsgs: d.MsgToWorker[] = [];
  const workers: WorkerChild[] = [];
  const hardwareConcurrency = navigator.hardwareConcurrency || 1;
  const totalWorkers = Math.max(Math.min(maxConcurrentWorkers, hardwareConcurrency), 2) - 1;
  const tick = Promise.resolve();

  const onMsgsFromWorker = (worker: WorkerChild, ev: MessageEvent) => {
    if (!isDestroyed) {
      const msgsFromWorker: d.MsgFromWorker[] = ev.data;
      if (Array.isArray(msgsFromWorker)) {
        msgsFromWorker.forEach(msgFromWorker => {
          if (msgFromWorker) {
            if (isString(msgFromWorker.rtnEventName)) {
              events.emit(msgFromWorker.rtnEventName as any, msgFromWorker.rtnEventData);

            } else {
              const task = tasks.get(msgFromWorker.stencilId);
              if (task) {
                tasks.delete(msgFromWorker.stencilId);
                if (msgFromWorker.rtnError) {
                  task.reject(msgFromWorker.rtnError);
                } else {
                  task.resolve(msgFromWorker.rtnValue);
                }

                worker.activeTasks--;
                if (worker.activeTasks < 0 || worker.activeTasks > 50) {
                  worker.activeTasks = 0;
                }

              } else if (msgFromWorker.rtnError) {
                console.error(msgFromWorker.rtnError);
              }
            }
          }
        });
      }
    }
  };

  const onError = (e: ErrorEvent) => console.error(e);

  const createWebWorkerMain = () => {
    const worker = new Worker(workerUrl, {
      name: `stencil-${workerName}-${workerName === 'compiler' ? version : workerIds++}`
    });
    const workerChild: WorkerChild = {
      worker,
      activeTasks: 0,
      sendQueue: [],
    };
    worker.onerror = onError;
    worker.onmessage = (ev) => onMsgsFromWorker(workerChild, ev);

    return workerChild;
  };

  const sendMsgsToWorkers = (w: WorkerChild) => {
    if (w.sendQueue.length > 0) {
      w.worker.postMessage(w.sendQueue);
      w.sendQueue.length = 0;
    }
  };

  const queueMsgToWorker = (msg: d.MsgToWorker) => {
    let theChoseOne: WorkerChild;

    if (workers.length > 0) {
      theChoseOne = workers[0];

      if (totalWorkers > 1) {
        for (const worker of workers) {
          if (worker.activeTasks < theChoseOne.activeTasks) {
            theChoseOne = worker;
          }
        }

        if (theChoseOne.activeTasks > 0 && workers.length < totalWorkers) {
          theChoseOne = createWebWorkerMain();
          workers.push(theChoseOne);
        }
      }

    } else {
      theChoseOne = createWebWorkerMain();
      workers.push(theChoseOne);
    }

    theChoseOne.activeTasks++;
    theChoseOne.sendQueue.push(msg);
  };

  const flushSendQueue = () => {
    isQueued = false;
    queuedSendMsgs.forEach(queueMsgToWorker);
    queuedSendMsgs.length = 0;
    workers.forEach(sendMsgsToWorkers);
  };

  const send = (...args: any[]) => new Promise<any>((resolve, reject) => {
    if (isDestroyed) {
      reject(TASK_CANCELED_MSG);

    } else {
      const msg: d.MsgToWorker = {
        stencilId: msgIds++,
        args,
      };
      queuedSendMsgs.push(msg);

      tasks.set(msg.stencilId, {
        resolve,
        reject,
      });

      if (!isQueued) {
        isQueued = true;
        tick.then(flushSendQueue);
      }
    }
  });

  const destroy = () => {
    isDestroyed = true;
    tasks.forEach(t => t.reject(TASK_CANCELED_MSG));
    tasks.clear();
    workers.forEach(w => w.worker.terminate());
    workers.length = 0;
  };

  return {
    send,
    destroy,
  };
};


interface WorkerChild {
  worker: Worker;
  activeTasks: number;
  sendQueue: d.MsgToWorker[];
}
