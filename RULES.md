- E2Eテストを通過してからpushすること.
- dashboardとreaderでは, `dueCardsCompleted`だけをprimary KPIとし, stabilityと解いた問題数は表示だけにすること.
- production同期E2Eのtoken準備は`npm run test:kakomonn-live-sync`のscriptへ任せること. CodexはChromeを直接操作しないこと. scriptは`KAKOMONN_SYNC_TOKEN`が未設定の場合だけ専用Chrome profileと標準Chrome profileのTampermonkey storageを検索し,productionの`/v8/sites`で認証できる1種類の値をignore済みの`.env`へ保存すること.token値をtool出力,log,回答,tracked fileへ表示または保存しないこと.設定済みの値がproductionで認証されない場合は,secretをrotateまたは置換せず,ユーザーへ矛盾を報告すること.
- dashboardとreaderの画面labelはAPIの英語identifierをそのまま使用すること. 学習指標は`dueCardsCompleted`, `dueCardsRemaining`, `stabilityDays`, `todayStabilityDaysDelta`, `stabilityDaysDelta`, `attemptedQuestionCount`, `todayAttemptedQuestionCount`, `closingStabilityDays`だけを正表記とし, goal/answer/count/mastery系や旧DO class名などの廃止表記をsource,test,doc,UIへ再導入しないこと. `npm run test:repository-naming`が通ること.
- `kakomonn-sync/`または`package.json`のkakomonn-sync向け設定を変更した場合は,最終`main`をpushした後に`npm run deploy:kakomonn-sync`を実行し,production asset一致testまで通過したことを確認すること.
- `kakomonn-reader/`, `scripts/release-kakomonn-reader.mjs`, `tests/release-kakomonn-reader.test.mjs`, または`package.json`のkakomonn-reader向けbuild,test,release設定を変更した場合は,prepushまたはcommit作業の一部として,最終`main`をpushした後に`npm run release:kakomonn-reader`を実行すること. GitHubのLatest Releaseのtarget SHAが最終`main`と一致し,`kakomonn-reader.user.js`がassetとして公開されたことを確認するまで作業を完了しないこと.
- `congratulations/`または`package.json`のcongratulations向け設定を変更した場合は, 最終`main`をpushした後に`npm run deploy:congratulations`を実行し, production E2Eまで通過したことを確認すること.

- Cloudflareのusage limitをなるべく使わない設計を心がけること.
