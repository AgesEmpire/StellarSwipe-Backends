/**
 * Raw request signals captured at login time, used to compute a
 * session fingerprint. All fields are optional since not every
 * client sends every header.
 */
export interface LoginSignals {
  ipAddress?: string;
  userAgent?: string;
  acceptLanguage?: string;
}
