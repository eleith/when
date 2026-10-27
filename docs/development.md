# Development

Read the [philosophy](philosophy.md). Then resist the urge to add a plugin system.

## run it

you can use Node 26 and pnpm (versions in `mise.toml`) directly. or you can use
docker. one is documented-ish. the other is not.

### docker development

With Docker, mise and fnox installed, start from `apps/web`:

```sh
mkdir -p config data public
cp -n ../../docs/when.example.yaml config/when.yaml
cp -n ../../docs/.env.example .env
openssl rand -base64 32
```

Fill in config and secrets, put the generated value in `AUTH_SECRET`, and set
`ORIGIN=http://localhost:5173`. Create `docker-compose.dev.local.yml`:

```yaml
services:
  when-app:
    env_file: .env
  when-worker:
    env_file: .env
```

Then run:

```sh
mise docker up --build
```

The task combines this override with `docker-compose.dev.yml`. Web is on 5173,
Mailpit on 8025. The [sample Compose file](compose.yaml) is for deployment, not
hot reload.

## Testing

write more than zero but not so many they aren't worth their costs.
Use the cheapest test that proves the behavior.
