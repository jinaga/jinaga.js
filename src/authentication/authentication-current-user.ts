import { LoginResponse } from '../http/messages';
import { FactEnvelope, FactRecord, FactReference } from '../storage';
import { Authentication } from './authentication';
import { CurrentUserSource } from './current-user';

/**
 * Remembers which user `login()` last resolved with, so a fact queued while
 * offline can be attributed to the user who wrote it rather than to whoever is
 * logged in when the queue drains (issue #412).
 *
 * It wraps the authentication the client would otherwise use, because the login
 * response is where the user's own fact appears. The token the connection
 * carries names a user to the replicator and to nothing on this side of it, so
 * the login is the only place a client learns who it is writing as.
 *
 * Nothing here authorizes or signs anything; it delegates both. A login that
 * fails leaves the current user as it was, so a failed sign-in cannot make one
 * user's queued facts sendable under another's token.
 */
export class AuthenticationCurrentUser implements Authentication, CurrentUserSource {
    private user: FactReference | null = null;

    constructor(
        private readonly inner: Authentication
    ) { }

    currentUser(): FactReference | null {
        return this.user;
    }

    async login(): Promise<LoginResponse> {
        const response = await this.inner.login();
        if (response && response.userFact) {
            this.user = {
                type: response.userFact.type,
                hash: response.userFact.hash
            };
        }
        return response;
    }

    local(): Promise<FactRecord> {
        return this.inner.local();
    }

    authorize(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return this.inner.authorize(envelopes);
    }
}
