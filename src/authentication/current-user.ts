import { FactReference } from '../storage';

/**
 * Reads the user who is current in this client (issue #412).
 *
 * The current user is the user the last `login()` resolved with. It is `null`
 * before any login has resolved, which is the state a client starts in: the
 * queue may already hold facts from an earlier session, and a token the
 * connection happens to carry names a user this side of the connection has not
 * read.
 */
export interface CurrentUserSource {
    currentUser(): FactReference | null;
}
