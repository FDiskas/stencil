import * as d from '../../../declarations';
import { EventEmitter } from 'events';
import { TASK_CANCELED_MSG } from '@utils';
import { NodeWorkerMain } from './worker-main';
import { cpus } from 'os';


export class NodeWorkerController extends EventEmitter {
  workerIds = 0;
  stencilId = 0;
  isEnding = false;
  taskQueue: d.CompilerWorkerTask[] = [];
  workers: NodeWorkerMain[] = [];
  totalWorkers: number;


  constructor(public forkModulePath: string, maxConcurrentWorkers: number, public logger: d.Logger) {
    super();
    this.totalWorkers = Math.max(Math.min(maxConcurrentWorkers, cpus().length), 1);
    this.startWorkers();
  }

  onError(err: NodeJS.ErrnoException, workerId: number) {
    if (err.code === 'ERR_IPC_CHANNEL_CLOSED') {
      return this.stopWorker(workerId);
    }
    if (err.code !== 'EPIPE') {
      this.logger.error(err);
    }
  }

  onExit(workerId: number) {
    setTimeout(() => {
      let doQueue = false;
      const worker = this.workers.find(w => w.id === workerId);

      if (worker) {
        worker.tasks.forEach(t => {
          t.retries++;
          this.taskQueue.unshift(t);
          doQueue = true;
        });
        worker.tasks.clear();
      }

      this.stopWorker(workerId);

      if (doQueue) {
        this.processTaskQueue();
      }
    }, 10);
  }

  startWorkers() {
    while (this.workers.length < this.totalWorkers) {
      this.startWorker();
    }
  }

  startWorker() {
    const workerId = this.workerIds++;
    const worker = new NodeWorkerMain(workerId, this.forkModulePath);

    worker.on('response', this.processTaskQueue.bind(this));

    worker.once('exit', () => {
      this.onExit(workerId);
    });

    worker.on('error', err => {
      this.onError(err, workerId);
    });

    this.workers.push(worker);
  }

  stopWorker(workerId: number) {
    const worker = this.workers.find(w => w.id === workerId);
    if (worker) {
      worker.stop();

      const index = this.workers.indexOf(worker);
      if (index > -1) {
        this.workers.splice(index, 1);
      }
    }
  }

  processTaskQueue() {
    if (this.isEnding) {
      return;
    }

    this.startWorkers();

    while (this.taskQueue.length > 0) {
      const worker = getNextWorker(this.workers);
      if (!worker) {
        break;
      }
      worker.run(this.taskQueue.shift());
    }
  }

  send(...args: any[]) {
    if (this.isEnding) {
      return Promise.reject(TASK_CANCELED_MSG);
    }

    return new Promise<any>((resolve, reject) => {
      const task: d.CompilerWorkerTask = {
        stencilId: this.stencilId++,
        inputArgs: args,
        retries: 0,
        resolve: resolve,
        reject: reject,
      };
      this.taskQueue.push(task);

      this.processTaskQueue();
    });
  }

  cancelTasks() {
    for (const worker of this.workers) {
      worker.tasks.forEach(t => t.reject(TASK_CANCELED_MSG));
      worker.tasks.clear();
    }
    this.taskQueue.length = 0;
  }

  destroy() {
    if (!this.isEnding) {
      this.isEnding = true;

      for (const task of this.taskQueue) {
        task.reject(TASK_CANCELED_MSG);
      }

      this.taskQueue.length = 0;

      const workerIds = this.workers.map(w => w.id);
      for (const workerId of workerIds) {
        this.stopWorker(workerId);
      }
    }
  }
}


export function getNextWorker(workers: NodeWorkerMain[]) {
  const availableWorkers = workers.filter(w => {
    if (w.stopped) {
      // nope, don't use this worker if it's exiting
      return false;
    }

    // this is an available worker up for the job, bring it!
    return true;
  });

  if (availableWorkers.length === 0) {
    // all workers are pretty tasked at the moment
    // Please come back again. Thank you for your business.
    return null;
  }

  const sorted = availableWorkers.sort((a, b) => {
    // worker with the fewest active tasks first
    if (a.tasks.size < b.tasks.size) return -1;
    if (a.tasks.size > b.tasks.size) return 1;

    // all workers have the same number of active tasks, so next sort
    // by worker with the fewest total tasks that have been assigned
    if (a.totalTasksAssigned < b.totalTasksAssigned) return -1;
    if (a.totalTasksAssigned > b.totalTasksAssigned) return 1;

    return 0;
  });

  return sorted[0];
}


export function setupWorkerController(sys: d.CompilerSystem, logger: d.Logger) {
  sys.createWorker = function (maxConcurrentWorkers) {
    const forkModulePath = sys.getCompilerExecutingPath();
    return new NodeWorkerController(forkModulePath, maxConcurrentWorkers, logger);
  };
}
