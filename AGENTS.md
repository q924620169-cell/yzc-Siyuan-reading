# yzc阅读

- One SiYuan Plugin instance, internal ID `yzc-Siyuan-reading`; document, Reader and RSS modules share its lifecycle.
- Preserve navigation contracts, book/database IDs, original asset paths and document categories.
- Persistent module state lives under `data/storage/petal/yzc-Siyuan-reading/reader` and `rss`. Valid new state wins, followed by old merged INL, then standalone Reader/RSS. Verify staging before promotion; retain all legacy sources and use a new-identity completion marker.
- Public visibility, a formal release and marketplace submission require the user's confirmation of the concrete release candidate.
- Keep all three old remote repositories. Their deletion is deferred by the user's review request.
- `npm run check` runs type checks, all module regressions and the complete ZIP build. Run `npm run test:browser` for layout changes.
- Real-host validation uses only a recoverable copy of `D:/AI-Projects/SiYuan-Test`; never deploy to a production workspace.
- Never commit `.local`, `validation`, credentials, workspace data, original books or generated packages.
