# Development

Read the [philosophy](philosophy.md). Then resist the urge to add a plugin system.

## run it

you can use Node 26 and pnpm (versions in `mise.toml`) directly. or you can use
docker. one is documented-ish. the other is not.

### docker development

With Docker installed, start from `apps/web`:

```sh
mkdir -p config data public
cp -n ../../docs/when.example.yaml config/when.yaml
chmod 600 config/when.yaml
```

Fill in `config/when.yaml` and set YAML `url.app` to `http://localhost:5173`.
No `.env` file or session key is required. If you want interpolation, create an
optional `.env` beside the development Compose file. To keep sessions across
restarts, set `auth.secret` in YAML or supply a stable `AUTH_SECRET`.

Then run:

```sh
docker compose -f docker-compose.dev.yml up --build
```

Web is on 5173,
Mailpit on 8025. The [sample Compose file](compose.yaml) is for deployment, not
hot reload.

## Testing

write more than zero but not so many they aren't worth their costs.
Use the cheapest test that proves the behavior.
