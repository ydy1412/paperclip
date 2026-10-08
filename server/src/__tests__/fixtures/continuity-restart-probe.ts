import { createDb, closeRegisteredClients } from "@paperclipai/db";
import { agentContinuityService } from "../../services/agent-continuity.js";
import { currentNativeControllerIdentity } from "../../services/native-runtime/native-restart-recovery.js";

const url = process.env.PAPERCLIP_CONTINUITY_TEST_DATABASE_URL;
if (!url) throw new Error("Disposable test database is required");
const targets = JSON.parse(process.env.PAPERCLIP_CONTINUITY_TEST_TARGETS ?? "[]") as { companyId: string; agentId: string }[];
try {
  const svc = agentContinuityService(createDb(url));
  const statuses = await Promise.all(targets.map(async target => (await svc.assess(target.companyId, target.agentId))[0]?.status));
  process.stdout.write(JSON.stringify({ bootId: (await currentNativeControllerIdentity()).bootId, statuses }));
} finally { await closeRegisteredClients(url); }
