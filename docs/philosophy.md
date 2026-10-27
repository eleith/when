# Philosophy

Schedule appointments for one person. Do it well. Stop there.

When is for the self-hoster who want a simple booking page that works well for
them and aren't going to get surprised one day with enterprise features they
are locked out of or source code that isn't open anymore (cough cough, i'm
looking at you every-other-appointment-service-ive-used)

## keep it simple

1. Simple: No teams, tenants, round-robin routing or plugin
   system.
2. Fastish: fast enough page loads, slow work done in the worker.
3. Low Maintenance: point one, but disguised as point three.

## just a text file ...

all your configuration lives in `when.yaml`. Edit it, back it up, put it in
Git.

## ... and two sqlite files

Appointments live in one SQLite. Background jobs live in another. They didn't
look as good in yaml.
