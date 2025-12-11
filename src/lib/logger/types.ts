import { CommitLog } from "./components/types";

export interface ILogWriter {
  readonly raiseExceptions: boolean;
  commit(log: CommitLog): void;
}