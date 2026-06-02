export class ApiError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

async function apiFetch<T>(url: string, opts: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem('auth_token');
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers ?? {}),
    };

    const res = await fetch(url, { ...opts, headers });

    if (res.status === 401) {
        localStorage.removeItem('auth_token');
        window.dispatchEvent(new Event('auth:expired'));
        throw new ApiError(401, 'Unauthorized');
    }

    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(res.status, body.error ?? res.statusText);
    }

    return res.json() as Promise<T>;
}

async function apiFetchBlob(url: string): Promise<Blob> {
    const token = localStorage.getItem('auth_token');
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    const res = await fetch(url, { headers });

    if (res.status === 401) {
        localStorage.removeItem('auth_token');
        window.dispatchEvent(new Event('auth:expired'));
        throw new ApiError(401, 'Unauthorized');
    }

    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(res.status, body.error ?? res.statusText);
    }

    return res.blob();
}

export const api = {
    get: <T>(url: string): Promise<T> => apiFetch<T>(url),
    post: <T>(url: string, body: unknown): Promise<T> =>
        apiFetch<T>(url, { method: 'POST', body: JSON.stringify(body) }),
    patch: <T>(url: string, body: unknown): Promise<T> =>
        apiFetch<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: <T>(url: string): Promise<T> => apiFetch<T>(url, { method: 'DELETE' }),
    download: async (url: string, filename: string): Promise<void> => {
        const blob = await apiFetchBlob(url);
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(href);
    },
};
