/**
 * Checks whether a Discord member has a required role by name.
 * `memberRoles` is the list of role names the member currently has.
 */
export function hasRole(memberRoles: string[], required: string): boolean {
  return memberRoles.includes(required);
}

export function isAdmin(memberRoles: string[]): boolean {
  return hasRole(memberRoles, 'Admin') || hasRole(memberRoles, 'Administrator');
}
