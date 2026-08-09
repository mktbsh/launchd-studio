# Changesets

ユーザー向けの変更を入れたら、変更用ファイルを1つ追加する。

```sh
bun run changeset
```

4つのworkspace packageは同じバージョンで管理される。Version Packages PRをmainへマージすると、`v<version>`タグが作られ、署名・Notarize済みバイナリのGitHub Releaseが作られる。
