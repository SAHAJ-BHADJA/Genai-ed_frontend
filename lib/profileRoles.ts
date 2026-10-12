export type AccountRole = 'educator' | 'student';

type RoleAwareProfile = {
  role?: string | null;
  roles?: string[] | null;
};

export function getProfileRoles(profile: RoleAwareProfile | null | undefined): AccountRole[] {
  if (!profile) return [];

  const declaredRoles = Array.isArray(profile.roles)
    ? profile.roles.filter((role): role is AccountRole => role === 'educator' || role === 'student')
    : [];

  if (declaredRoles.length > 0) {
    return Array.from(new Set(declaredRoles));
  }

  // Rollout compatibility: educator accounts have student capability even
  // before the roles migration has been applied to a deployment.
  if (profile.role === 'educator') return ['educator', 'student'];
  if (profile.role === 'student') return ['student'];
  return [];
}

export function hasProfileRole(
  profile: RoleAwareProfile | null | undefined,
  role: AccountRole,
) {
  return getProfileRoles(profile).includes(role);
}
