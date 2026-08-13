# @pyper/web

The Pyper marketing site — [Next.js](https://nextjs.org) (App Router, TypeScript).

This is a **minimal scaffold**: a single branded landing page. Extend `app/page.tsx`
and `app/globals.css` (or add routes under `app/`) to build it out.

## Develop

From the monorepo root:

```bash
npm install
npm run web            # or: npx turbo run dev --filter=@pyper/web
```

Then open http://localhost:3000.

## Build

```bash
npx turbo run build --filter=@pyper/web
```
