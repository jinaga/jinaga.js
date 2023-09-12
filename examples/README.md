# Examples

To run examples, install the [httpYac](https://marketplace.visualstudio.com/items?itemName=anweber.vscode-httpyac) extension.

Create a replicator.
When you set up authentication, make sure to add the callback URL `http://localhost:3000/callback`

Create a file called `.env.local` in the `examples` directory. Enter the URL of a replicator.

```
replicatorUrl=https://repdev.jinaga.com/xxxxxxxxxxxxxxx
oauth2_tokenEndpoint=https://repdev.jinaga.com/xxxxxxxxxxxxxxx/auth/token
oauth2_authorizationEndpoint=https://repdev.jinaga.com/xxxxxxxxxxxxxxx/auth/apple
oauth2_clientId=xxxxxxxxxxxxxxx
oauth2_usePkce=true
```

Then choose your favorite example and run it.