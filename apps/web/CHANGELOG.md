# @when/web

## 0.0.12

### Patch Changes

- de52a83: Fix floating-point truncation in admin dashboard lifetime and weekly meeting minutes calculation by using unixepoch integer arithmetic
- a0bdf30: Count only confirmed appointments for admin dashboard lifetime meetings metric, excluding cancelled, declined, expired, and intermediate rescheduled records
- ff376ad: Bound admin dashboard total this month metric to confirmed appointments within the current month and fix weekly scheduled minutes date range

## 0.0.11

### Patch Changes

- f0bd354: Migrate local dev secret management and Docker workflows to fnox and mise.
- a108c66: Add meeting types health section with booking counts and public/unlisted meeting setup cards on the admin dashboard.
- e26d1c0: Simplify admin navigation on user-facing pages: replace top admin banner with an avatar badge on the home page, remove admin banners from wizards, and add subtle footer navigation between admin and public pages.

## 0.0.10

### Patch Changes

- 1821d28: improve today indicator and make more clear the day hover style
- 3c82314: improved headers and spacing for admin dashboard
- 3c01df2: improve ux for duration selection and slot picker rendering

## 0.0.9

### Patch Changes

- d19ab78: Add configurable OIDC provider display name and configure state checks for Authelia compatibility

## 0.0.8

### Patch Changes

- a262027: Reflect concluded and in-progress states in appointment detail banner and suppress calendar links on concluded appointments.
- a262027: improve title/header for concluded and inprogress appointments
