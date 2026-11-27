/** Why the server turned a command down, with a message fit to show the person holding the device. */
export type Refusal = { error: string; status: 400 | 401 | 403 | 404 | 409 };
