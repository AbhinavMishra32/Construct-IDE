import type { ConstructApi } from "../shared/api";
declare global { interface Window { construct: ConstructApi; MonacoEnvironment: { getWorker(moduleId:string,label:string):Worker } } }
export {};
