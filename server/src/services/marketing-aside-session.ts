// Keep the marketing transport API while sharing native session mechanics.
export {
  parseAsidePreparedSession as parseMarketingAsidePreparedSession,
  parseAsideSessionState as parseMarketingAsideSessionState,
  readAsideSession as readMarketingAsideSession,
  readAsideAssistantResults as readMarketingAsideAssistantResults,
  prepareAsideSession as prepareMarketingAsideSession,
  resumeAsideSession as resumeMarketingAsideSession,
} from "./aside-session.js";
