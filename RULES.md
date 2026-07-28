- E2Eテストを通過してからpushすること.
- `kakomonn-reader/`, `scripts/release-kakomonn-reader.mjs`, `tests/release-kakomonn-reader.test.mjs`, または`package.json`のkakomonn-reader向けbuild,test,release設定を変更した場合は,prepushまたはcommit作業の一部として,最終`main`をpushした後に`npm run release:kakomonn-reader`を実行すること. GitHubのLatest Releaseのtarget SHAが最終`main`と一致し,`kakomonn-reader.user.js`がassetとして公開されたことを確認するまで作業を完了しないこと.
- `congratulations`を変更した場合は,push後にPlaywrightで`https://kakomonn-congratulations.expgolem-lab.workers.dev/?milestone=50`を開き,期待する主要要素が表示され,page errorが発生していないことを確認すること. 正常表示を確認できない場合は,作業を完了せず,原因を修正すること.

## 典型的な失敗を避けるための注意点

- VCS操作にはgitではなくjjを使うこと.
- Windowsローカルで完結できるbuild,test,release,deployにGitHub Actionsを使わないこと. リポジトリ内のscriptと実行手順を用意すること. ActionsはWindowsで代替できないOS固有検証などに限定すること.
- remoteの変更を取り込むときは, `main@origin`だけでなく, `jj bookmark list --all`で全remote bookmarkを確認すること. agent用bookmarkにだけ存在するcommitも統合対象から漏らさないこと.
- remoteが更新され続ける作業では, 統合前, テスト前, push直前に`jj git fetch --remote origin`を実行すること. fetch後に新しいcommitが入った場合は, 統合と関連テストをやり直すこと.
- fetchによって`main`がconflictしたときは, 片方を捨てて解消しないこと. 全remote系列を統合したrevisionを作り, `jj bookmark set main -r <revision>`で解消すること.
- PowerShellでは, jjのrevision `@`や`name@origin`を必ず引用符で囲むこと. 引用しない`@`はPowerShell構文として解釈される.
- Node.jsで`import.meta.url`からpathを作るときは, URLの`pathname`を直接`resolve`へ渡さず, `fileURLToPath`を使うこと. Windowsでは`C:\\C:\\...`のような不正pathになる.
- browser testで`/usr/bin/chromium`などのOS固有pathを固定しないこと. packageで管理したPlaywrightの`chromium.launch`を使うこと.
- `npm ci`を手順に書くpackageには, 対応する`package-lock.json`を必ずcommitすること.
- buildやE2Eが生成する`dist/`, screenshot, result fileは, テスト実行前にpackage直下の`.gitignore`へ明示すること. 生成物をsource差分へ混入させないこと.
- npmが`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`になった場合はTLS検証を無効化しないこと. この環境では`NODE_OPTIONS=--use-system-ca`をnpm processへ設定し, OSのCA storeを使うこと.
- 最終E2Eが通った後にremote更新を取り込んだ場合は, E2Eを再実行すること.
- push後は再fetchし, `jj bookmark list --all`でlocalとremoteを含めて`main`だけになっていることを確認すること.
