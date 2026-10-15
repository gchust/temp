/** Only the existing, validated proxy route is passed to an HTTP reader. */
export interface PublicProxyProfile {
  kind?: 'proxy';
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
  revision: number;
  updatedAt: string;
}

/** A structural port; plugins never import the application's concrete network service. */
export interface PublicNetwork {
  readonly simulation?: { readonly enabled: boolean };
  selected(connection: string): PublicProxyProfile | undefined;
  fetch(connection: string, input: string | URL, init?: RequestInit): Promise<Response>;
  send(
    profile: PublicProxyProfile | undefined,
    url: URL,
    init: RequestInit,
    pinned?: { address: string; hostname: string },
    maxBytes?: number,
  ): Promise<Response>;
}
