// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendCall = (endpoint: any, args: any) => Promise<any>;

export interface ConvexRepositoryOptions {
  readonly backend: { mutation: BackendCall; query: BackendCall };
  readonly sessionId: string;
}

export interface ConvexMutationRepositoryOptions {
  readonly backend: { mutation: BackendCall };
  readonly sessionId: string;
}
