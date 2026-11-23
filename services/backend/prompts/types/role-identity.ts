/** The identity a role presents to its agent: the title and description rendered in its prompt. */
export interface RoleIdentity {
  readonly title: string;
  readonly description: string;
}
