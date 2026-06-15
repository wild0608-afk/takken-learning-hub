# Phase B verified化 運用ガードレール

Takken Learning Hub の verified 自走作業で繰り返し発生した既知問題を防ぐための運用ルール。
実行AI（Opus/Sonnet＝Claude Code 上で動く実行AI）は、本書を verified 作業の前提として適用する。
最終判断は人間、独立検証は Codex。実行AIの自己判定は最終承認に数えない。

---

## 1. Tool call 二重生成禁止

同一目的・同一内容の tool call を1メッセージ内に2つ以上出さない。

- **Bash：** 同じ command / description の重複禁止
- **Read：** 同じ file_path / offset / limit の重複禁止
- **Grep：** 同じ pattern / path / output_mode の重複禁止
- **Edit：** 同じ file_path / old_string / new_string の重複禁止
- **Create / Write：** 同じ file_path の重複禁止
- 複数 Read は、**offset や対象IDが違う場合のみ許可**（別箇所確認は重複ではない）
- **同一 tool call が2つ出てしまったら、実行せず、2つ目を削除してから再提示する**
- **commit / push / Edit 系は特に1回のみ**（破壊・不可逆寄りのため最優先で単発化）
- 提出前に、自分の出力内に同一 call ブロックが二重生成されていないか自己点検する

## 2. git diff 読み取りルール

- `- verified: false` と `+ verified: true` が並ぶのは、**git diff の旧行（削除）と新行（追加）の差分表示**であり、**実ファイル上の重複とは限らない**
- diff の `-`/`+` が balanced（旧行が `-` で消え、新行が `+` で入る）なら、実ファイルは**置換済み＝重複なし**
- **重複の疑いがある場合は、対象IDの実ファイルブロックを Read して確認する**（破損判定は実ファイル Read を正とする）
- 実ファイル上で同じキー（verified / confidence 等）が**各1回だけ**なら問題なし
- **diff の見た目だけで「重複」と断定しない**（コンソール表示の文字化け・色消失も同様に誤判定要因）

## 3. 問題形式判定ルール

- **「正しいものはどれか」：** 正しい肢が**1つだけ**でなければならない（正しい肢が2つ以上＝唯一解崩れ）
- **「誤っているものはどれか」：** 誤り肢が**1つだけ**でなければならない（誤り肢が2つ以上＝唯一解崩れ）
- 「誤っているもの」形式で**正しい肢が複数あること自体は問題ではない**
- 「正しいもの」形式で**誤り肢が複数あること自体は問題ではない**
- 判定時は必ず **question 文・correct・全 options・explanation をセットで確認**する（形式の取り違えを防ぐ）

## 4. 法解釈・制度混同の停止条件

以下の疑いが出たら、**verified化せず、保留または Codex 確認に回す**：

- 宅建業免許と宅建士証の制度混同
- 登録・免許・取引士証・従業者証明書の混同
- 保存期間・更新期限・届出期限・講習時期など**数字の不一致**
- 法改正の疑い
- explanation が**別制度の条文**を引いている疑い
- 正解肢が**現行法とズレている**疑い
- 複数正解または唯一解崩れの疑い

## 5. verified化の許可条件

`verified:true` / `confidence:"high"` を付けてよいのは、**以下をすべて満たす場合のみ**：

- 唯一解が成立
- 現行法と整合
- explanation が正しい
- question / options / correct / explanation に矛盾なし
- 制度混同なし
- 法改正疑いなし
- verify 通過（総500問・各カテゴリ125問・ID重複なし・エラー0・警告0）
- diff が対象ID・対象フィールドに限定されている

1つでも欠けたら verified化しない（保留 or Codex）。

## 6. 自走範囲

**実行AI（Claude Code）が自走してよいこと：**

- Read / Grep
- 唯一解判定
- 安定問題の verified / confidence 付与（5章の条件を満たす場合）
- 危険IDの保留リスト化
- Codex review-request の作成
- diff / verify / status の確認
- commit可否レポートの作成

**実行AIが勝手にしてはいけないこと（必ず人間承認 or Codex）：**

- `git add .`
- commit
- push
- correct の変更
- 高リスクな question / options / explanation の修正
- Codex確認が必要な論点の自己確定

## 7. 作業後レポート形式

毎回、以下を報告する：

1. verified化したID
2. 保留IDと理由
3. 変更フィールド
4. 唯一解判定
5. verify結果
6. git diff 要約
7. git status
8. commit可否判断

---

本書は Takken Learning Hub Phase B 専用の運用ガードレール。questions データには影響しない補助文書であり、commit/push は人間承認後に判断する。
