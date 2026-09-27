# Shadow Live — Cloudflare R2 Storage

## Scope

Cloudflare R2 is the object store for mutable user-generated files. The bucket is private and is accessed only through the Cloudflare Worker binding `USER_STORAGE`.

GitHub remains the source for static application assets such as games, gifts, badges, VIP art, icons, and bundled backgrounds.

## Bucket

- Name: `shadow-live-storage`
- Visibility: private
- Worker binding: `USER_STORAGE`

No R2 access key or secret is shipped inside Flutter.

## Canonical object prefixes

- Profile image: `users/<uid>/profile/<uuid>.<ext>`
- Profile cover: `users/<uid>/covers/<uuid>.<ext>`
- Room cover: `rooms/<roomId>/covers/<uuid>.<ext>`
- Chat image: `chat/<conversationId>/<uid>/<uuid>.<ext>`

## Security model

Firebase Auth remains the identity layer. The Worker verifies the Firebase ID token before storage operations and checks ownership or membership before accepting storage operations.

Firestore stores only storage metadata such as object key, MIME type, size, owner, and timestamps; object bytes are never stored in Firestore.

## Rollout order

1. R2 bucket + binding + health.
2. Worker storage API and authorization.
3. Profile image.
4. Profile cover.
5. Room cover.
6. Chat images.
7. Android/PWA verification.
8. Remove Firebase Storage dependency/workflow after R2 production smoke passes.
