/**
 * Training sessions and matches (B-318): drill and participation
 * vocabularies and the window of the player's RPE submission.
 */
export {
  CONTACT_LEVELS,
  NO_LOAD_PARTICIPATION_STATUSES,
  PARTICIPATION_STATUSES,
  isContactLevel,
  isParticipationStatus,
  parseContactLevel,
  parseParticipationStatus,
  participationCarriesLoad,
  type ContactLevel,
  type ParticipationStatus,
} from './vocabularies.js';
export {
  DEFAULT_RPE_WINDOW,
  MAX_RPE_WINDOW_CLUB_DAYS,
  rpeSubmissionWindow,
  rpeWindowState,
  type RpeWindow,
  type RpeWindowParameters,
  type RpeWindowSession,
  type RpeWindowState,
} from './rpe-window.js';
