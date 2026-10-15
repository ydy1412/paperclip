import type { IncomingMessage, ServerResponse, Server } from "node:http";
export interface CredentialVault { has(id: string): boolean; set(id: string, value: Record<string,string>): Promise<void>; get(id: string): Promise<Record<string,string>>; remove(id: string): Promise<void>; }
export interface DobiWorkspace { handler(req: IncomingMessage & {body?: unknown; dobiOwnerId?: string}, res: ServerResponse): Promise<void>; close(): Promise<void>; }
export function createApp(options?: {dbPath?:string;dataRoot?:string;port?:number;hosted?:boolean;vault?:CredentialVault;fetchImpl?:typeof fetch;resolveHost?:boolean;bridgeBase?:string;authorizeBridge?:(ownerId:string)=>Promise<boolean>}): Promise<DobiWorkspace>;
