# yzc阅读增强

- One SiYuan Plugin instance, internal ID `yzc-INL`; document, Reader and RSS modules share its lifecycle.
- Preserve navigation contracts, book/database IDs, original asset paths and document categories.
- Persistent module state lives under `data/storage/petal/yzc-INL/reader` and `rss`. Migration copies missing files only and never deletes legacy sources.
- `npm run check` runs type checks, all module regressions and the complete ZIP build. Run `npm run test:browser` for layout changes.
- Real-host validation uses only a recoverable copy of `D:/AI-Projects/SiYuan-Test`; never deploy to a production workspace.
- Never commit `.local`, `validation`, credentials, workspace data, original books or generated packages.
