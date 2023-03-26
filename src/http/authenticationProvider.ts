export interface HttpHeaders {
  "Authorization"?: string;
  [key: string]: string | undefined;
}

export interface AuthenticationProvider {
  getHeaders(): Promise<HttpHeaders>;
  reauthenticate(): Promise<boolean>;
}