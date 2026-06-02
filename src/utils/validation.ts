const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CARDE_ID_RE = /^[1-9][0-9]*$/;

export function validateUsername(username: string): string | null {
    if (!USERNAME_RE.test(username)) {
        return 'username must be 3–32 chars: lowercase letters, digits, underscore, hyphen';
    }
    return null;
}

export function validatePassword(password: string): string | null {
    if (password.length < 6) return 'password must be at least 6 characters';
    if (password.length > 128) return 'password must be at most 128 characters';
    return null;
}

export function validateCardeExternalId(externalId: string): string | null {
    if (!CARDE_ID_RE.test(externalId.trim())) {
        return 'Carde external ID must be a positive integer';
    }
    return null;
}

export function validatePfExternalId(externalId: string): string | null {
    if (!UUID_RE.test(externalId.trim())) {
        return 'PF external ID must be a UUID';
    }
    return null;
}

export function validateSourceExternalId(source: string, externalId: string): string | null {
    if (source === 'carde') return validateCardeExternalId(externalId);
    if (source === 'purplefox') return validatePfExternalId(externalId);
    return `unknown source: ${source}`;
}
