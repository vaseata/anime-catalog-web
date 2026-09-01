// 好みの計算。★画面（ブラウザ）と 通知（Node）の両方から使う。
//
// ★機械学習は使わない★
//   足し算と、説明できる重みだけ。理由が言えないおすすめは出さないため。
//   （R2の学び「機械が判定を外し続ける領域は、機械から降ろす」への担保）
//
// 決めるのは利用者。この計算がやるのは「並べ替え」と「理由を言うこと」だけ。

/** 何を、どれくらい信じるか。★ここが全部。増やすなら理由とセットで。 */
export const 重み = {
  '★5': 2.0,   // はっきり好き
  '★4': 1.0,
  '★3': 0.0,   // どちらでもない＝手がかりにしない
  '★2': -1.0,
  '★1': -2.0,  // はっきり苦手
  みたい: 1.0,  // 押したが、まだ観ていない
  タネ: 1.2,   // 好み聞き取りでタップした
  // ★2026-08-31 追加：利用者の指摘
  //   それまでこの装置は「押した」しか学べなかった。観ないと『違う』と言えなかった。
  //   ★ただし「押されなかった＝嫌い」と機械が決めるのは危険（まだ見ていないだけかもしれない）。
  //   利用者が自分で押して伝える。★1(-2.0)ほど強くはしない ─ 観ていないので。
  興味ない: -1.2,
  // ★自分で選んだ言葉。利用者がはっきり「これが好き」と言ったものなので、いちばん強い
  //   （利用者の指摘→ ゼロから書かせず、並べて選ばせる）
  言葉: 2.5,
};

/** 材料の種類ごとの効き目。タグはAniListの重み(0-100)を掛ける。 */
const 効き = { タグ: 1.0, ジャンル: 0.9, スタジオ: 0.7, 原作: 0.4 };

const 空 = () => ({ タグ: {}, ジャンル: {}, スタジオ: {}, 原作: {} });

/** 作品1つを、計算に使える形にそろえる（タネもカタログも同じ形にする） */
function 素材(w) {
  if (!w) return null;
  return {
    id: w.id,
    タイトル: w.タイトル,
    タグ: w.タグ ?? [],
    ジャンル: w.ジャンル ?? [],
    スタジオ: w.スタジオ ?? [],
    原作: w.原作 ? [w.原作] : [],
  };
}

/**
 * 好みプロフィールを作る。
 * @param picks     好み聞き取りでタップした作品（seeds.json の形）
 * @param reviews   ★点数（reviews.json）
 * @param watchlist ♥みたい（watchlist.json）
 * @param byId      カタログ Map<id, 作品>　※reviews/watchlist の中身を引くのに使う
 */
export function buildTaste({ picks = [], reviews = [], watchlist = [], notForMe = [], 選んだ言葉 = [], byId = new Map() } = {}) {
  const taste = 空();
  const 出どころ = {};       // 'タグ:Isekai' → [{タイトル, ラベル, 効き}]
  const 数 = { タネ: 0, 評価: 0, みたい: 0, 興味ない: 0, 言葉: 0 };

  const 足す = (src, w, ラベル) => {
    const m = 素材(src);
    if (!m || !w) return;
    for (const 種 of ['タグ', 'ジャンル', 'スタジオ', '原作']) {
      for (const item of m[種]) {
        const 名前 = typeof item === 'string' ? item : item.名前;
        const 強さ = typeof item === 'string' ? 1 : (item.重み ?? 50) / 100;
        if (!名前) continue;
        const 値 = w * 強さ * 効き[種];
        taste[種][名前] = (taste[種][名前] ?? 0) + 値;

        if (値 > 0) {
          const k = `${種}:${名前}`;
          (出どころ[k] ??= []).push({ タイトル: m.タイトル, ラベル, 効き: 値 });
        }
      }
    }
  };

  for (const p of picks) { 足す(p, 重み.タネ, '好みに選んだ'); 数.タネ++; }

  for (const r of reviews) {
    const 点 = r['★'] ?? 0;
    if (!点) continue;                       // 未評価の「みた」は手がかりにしない
    足す(byId.get(r.id) ?? r, 重み[`★${点}`] ?? 0, `★${点}`);
    数.評価++;
  }

  for (const x of watchlist) {
    if (reviews.some((r) => r.id === x.id && r['★'])) continue;   // ★があるなら二重に数えない
    足す(byId.get(x.id), 重み.みたい, '♥みたいに入れた');
    数.みたい++;
  }

  for (const x of notForMe) { 足す(byId.get(x.id), 重み.興味ない, '興味ないと押した'); 数.興味ない++; }

  // ★自分で選んだ言葉は、作品を経由せず直接足す（出どころは「自分で選んだ」）
  for (const w of 選んだ言葉) {
    const 種 = w.種 ?? 'タグ';
    const 向き = w.向き ?? 1;                     // 1=好き / -1=苦手
    taste[種][w.名前] = (taste[種][w.名前] ?? 0) + 重み.言葉 * 効き[種] * 向き;
    if (向き > 0) (出どころ[`${種}:${w.名前}`] ??= []).unshift({ タイトル: null, ラベル: '自分で選んだ', 効き: 999 });
    数.言葉++;
  }

  // 出どころは、いちばん効いた2件だけ残す（理由を書くのに使う）
  for (const k of Object.keys(出どころ)) {
    出どころ[k].sort((a, b) => b.効き - a.効き);
    出どころ[k] = 出どころ[k].slice(0, 2);
  }

  return { 作った日: new Date().toISOString(), 材料: 数, ...taste, 出どころ };
}

/** 好みプロフィールが空かどうか（＝まだ何も教わっていない） */
export function tasteは空(taste) {
  if (!taste) return true;
  return ['タグ', 'ジャンル', 'スタジオ', '原作'].every((k) => !Object.keys(taste[k] ?? {}).length);
}

/**
 * 珍しさの重み。★2026-08-31 利用者の指摘で追加★
 *
 * 〈ドラマ〉は248作品中53作品に付いている。そんな広い言葉は好みをほとんど表さない。
 * 逆に〈タイムリープ〉は2作品しかない ── 付いていること自体が強い情報。
 * **世間に多い言葉ほど軽く、珍しい言葉ほど重く**する。
 *
 * 実測でこうなっていた：おすすめ上位8件のうち6件の理由が
 * 「〈ドラマ〉〈アクション〉」で同じだった。広い言葉が全部を押し流していた。
 */
function 珍しさを測る(works) {
  const df = { タグ: {}, ジャンル: {}, スタジオ: {}, 原作: {} };
  for (const w of works) {
    const m = 素材(w);
    for (const 種 of ['タグ', 'ジャンル', 'スタジオ', '原作']) {
      for (const item of new Set(m[種].map((x) => (typeof x === 'string' ? x : x.名前)))) {
        if (item) df[種][item] = (df[種][item] ?? 0) + 1;
      }
    }
  }
  const N = Math.max(works.length, 1);
  // よくある言葉ほど 1 に近づき、珍しい言葉ほど大きくなる
  return (種, 名前) => Math.log(N / (1 + (df[種]?.[名前] ?? 0))) + 1;
}

/** 1作品の生の点と、効いた要素。 */
function 生の点(w, taste, 珍しさ = () => 1) {
  const m = 素材(w);
  let 点 = 0;
  const 効いた = [];
  for (const 種 of ['タグ', 'ジャンル', 'スタジオ', '原作']) {
    for (const item of m[種]) {
      const 名前 = typeof item === 'string' ? item : item.名前;
      const 強さ = typeof item === 'string' ? 1 : (item.重み ?? 50) / 100;
      const t = taste[種]?.[名前];
      if (!t) continue;
      const 値 = t * 強さ * 効き[種] * 珍しさ(種, 名前);
      点 += 値;
      効いた.push({ 種, 名前, 値 });
    }
  }
  効いた.sort((a, b) => b.値 - a.値);

  // ★2026-08-31 利用者の指摘で修正★
  //   合計で点を出すと、タグをたくさん持っている作品が内容に関係なく勝つ。
  //   実測：ONE PIECE はタグ＋ジャンルが40個（平均7.4個）あるだけで1位になっていた。
  //   → 「いちばん効いた5つ」だけで決める。数の多さが有利にならないように。
  const 上位 = 効いた.slice(0, 数える上限).reduce((a, e) => a + e.値, 0);
  return { 点: 上位, 効いた };
}

/** 点を決めるのに使う要素の数。多いほど「タグの多い作品」が有利になる */
const 数える上限 = 5;

/**
 * 理由を1行にする。★理由の言えないおすすめは出さない。
 * 例：「★5『鬼滅の刃』と同じ〈超能力〉〈悪魔・鬼〉」
 */
function 理由を書く(効いた, taste, lexicon) {
  const 除外 = new Set(lexicon?.['理由に使わないタグ'] ?? []);
  const 訳 = (種, 名前) =>
    種 === 'タグ' ? (lexicon?.['タグ']?.[名前] ?? 名前)
    : 種 === 'ジャンル' ? (lexicon?.['ジャンル']?.[名前] ?? 名前)
    : 種 === '原作' ? (lexicon?.['原作']?.[名前] ?? 名前)
    : 名前;

  const 使える = 効いた.filter((e) => e.値 > 0 && !(e.種 === 'タグ' && 除外.has(e.名前)));
  if (!使える.length) return null;

  const 中身 = 使える.filter((e) => e.種 !== 'スタジオ').slice(0, 2);
  const 工房 = 使える.find((e) => e.種 === 'スタジオ');
  if (!中身.length && !工房) return null;

  const 出どころ = (e) => taste.出どころ?.[`${e.種}:${e.名前}`]?.[0];
  const 節 = [];

  // ★節ごとに、それぞれの出どころを書く。2つの出どころを1つの文につなぐと嘘になる。
  //   （実例：「好みに選んだ『シュタインズ・ゲート ゼロ』と同じ〈ドラマ〉。制作も同じ〈ufotable〉」
  //     ─ シュタゲゼロは ufotable ではない。ufotable は『鬼滅の刃 遊郭編』から来ていた）
  if (中身.length) {
    const src = 出どころ(中身[0]);
    const 語 = 中身.map((e) => `〈${訳(e.種, e.名前)}〉`).join('');
    節.push(src ? (src.タイトル ? `${src.ラベル}『${src.タイトル}』と同じ${語}` : `${src.ラベル}${語}`) : `${語}が好みに近い`);
  }
  if (工房) {
    const src = 出どころ(工房);
    節.push(src?.タイトル ? `制作は〈${工房.名前}〉─ ${src.ラベル}『${src.タイトル}』と同じ`
                : `制作は〈${工房.名前}〉`);
  }
  return 節.join('。');
}

/**
 * カタログを、好みの順に並べる。
 * @param 除外 すでに押した／観た作品の id（おすすめに出しても意味がない）
 * @returns [{ w, 点(0-100), 理由 }] 点の高い順
 */
export function rankWorks(works, taste, { lexicon = null, 除外 = new Set(), 人気の扱い = 'マイナーを上に' } = {}) {
  if (tasteは空(taste)) return [];

  // 珍しさは「いま並べようとしている作品の集まり」から測る
  const 珍しさ = 珍しさを測る(works);
  const 候補 = works.filter((w) => !除外.has(w.id));
  const raw = 候補.map((w) => ({ w, ...生の点(w, taste, 珍しさ) }));

  const 最大 = Math.max(...raw.map((r) => r.点), 0.0001);
  const 最小 = Math.min(...raw.map((r) => r.点), 0);

  /**
   * 人気の順位（0＝いちばんマイナー、1＝いちばんメジャー）。
   * ★2026-08-31 利用者の指摘
   * 実測：利用者が♥を押した12作品のうち11作品が、人気の下位76%以下だった。
   * ★人気の値は桁が違いすぎる（23〜746,270）ので、値ではなく順位で見る。
   */
  const 人気順 = [...候補].sort((a, b) => (a.人気 | 0) - (b.人気 | 0)).map((w) => w.id);
  const 位置 = new Map(人気順.map((id, i) => [id, 候補.length > 1 ? i / (候補.length - 1) : 0]));
  const 係数 = 人気の扱い === 'マイナーを上に' ? 35 : 人気の扱い === '人気を上に' ? -35 : 0;

  return raw
    .map((r) => {
      const 中身 = ((r.点 - 最小) / (最大 - 最小 || 1)) * 100;
      const p = 位置.get(r.w.id) ?? 0.5;
      return {
        w: r.w,
        点: Math.max(0, Math.round(中身 - 係数 * p)),
        中身の点: Math.round(中身),
        人気の位置: p,           // 0=マイナー 1=メジャー
        理由: 理由を書く(r.効いた, taste, lexicon),
      };
    })
    // ★理由の言えないものは、おすすめとして出さない
    .filter((r) => r.理由)
    .sort((a, b) => b.点 - a.点);
}

/** その作品が、どれくらい知られていないか。理由に添える一言。 */
export function 知られ具合(人気の位置) {
  if (人気の位置 == null) return null;
  if (人気の位置 <= 0.25) return '🔍 まだほとんど知られていません';
  if (人気の位置 <= 0.55) return '🔍 あまり知られていません';
  if (人気の位置 >= 0.95) return '📣 とても有名です';
  return null;
}

/**
 * 「🔥 あの続きです」枠。★学習なしで、いちばんペインに効く。
 * 利用者が押した／観た作品を「前作」に持つものを探す。
 */
export function 続編を探す(works, 気にしているIds, lineage = null) {
  const 気 = new Set(気にしているIds);
  const 先祖 = lineage?.先祖 ?? {};
  const 題 = lineage?.題 ?? {};

  return works
    .filter((w) => w.区分 !== '放送終了')
    .map((w) => {
      // ① AniListが書いている「1つ前」
      const 直の親 = (w.関連?.前作 ?? []).filter((p) => 気.has(p.id));
      // ② ★シリーズを遡って見つけた先祖（利用者の指摘・2026-09-01）
      //    『幼女戦記Ⅱ』の前作は AniList では『劇場版 幼女戦記』としか書かれておらず、
      //    利用者が好きな TV版『幼女戦記』(2017) に届かなかった。3代さかのぼって届く。
      const 遠い先祖 = (先祖[w.id] ?? []).filter((id) => 気.has(id));
      if (!直の親.length && !遠い先祖.length) return null;
      const 元 = 直の親.length
        ? 直の親[0].タイトル
        : (題[遠い先祖[遠い先祖.length - 1]] ?? '前の作品');
      return { w, 理由: `『${元}』の続き`, 直系: !!直の親.length };
    })
    .filter(Boolean);
}

/* ───────── 🆕 前例のない作品 ─────────
   ★利用者（2026-08-31）：
     「極論すると、観たことないものを観たいという、困った望みなのです」
     「前衛的な作品、革新的な作品でもいいです」

   ★これは「おすすめ」ではない★
     推薦は過去に似たものしか出せないので、原理的に「観たことないもの」を出せない。
     だから好みと照らさない。**世間にその言葉がほとんど無いこと**だけを見る。

   実測の裏づけ（『海が走るエンドロール』）：
     女性主人公 1,141作品／Elderly Protagonist **7作品**／Filmmaking **8作品**
     → 利用者が「斬新！」と思った要素だけが、世間に7〜8作品しかなかった。 */

/** 世間（seeds）での出現数を数える。ここが「前例の多さ」の物差し。 */
export function 世間の数を測る(seeds) {
  const df = new Map();
  for (const w of seeds) {
    for (const t of new Set((w.タグ ?? []).filter((x) => x.重み >= 60).map((x) => x.名前))) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  return { df, N: Math.max(seeds.length, 1) };
}

/**
 * 前例のない順に並べる。
 * @param 世間  世間の数を測る() の結果
 * @returns [{ w, 点, 珍しい: [{名前, 世間数}], 理由 }]
 */
export function 前例のない(works, 世間, { lexicon = null, 除外 = new Set(), 人気の扱い = 'マイナーを上に' } = {}) {
  const { df, N } = 世間;
  const 訳 = (t) => lexicon?.['タグ']?.[t] ?? t;
  const 除外タグ = new Set(lexicon?.['理由に使わないタグ'] ?? []);

  const 候補 = works.filter((w) => !除外.has(w.id));
  if (!候補.length) return [];

  const raw = 候補.map((w) => {
    const ts = (w.タグ ?? [])
      .filter((x) => x.重み >= 60 && !除外タグ.has(x.名前))
      .map((x) => ({ 名前: x.名前, 世間数: df.get(x.名前) ?? 0 }))
      .sort((a, b) => a.世間数 - b.世間数);
    // 珍しい言葉が2つ以上ないと「たまたま」かもしれない
    if (ts.length < 2) return { w, 点: 0, 珍しい: [] };
    const 上位 = ts.slice(0, 3);
    const 点 = 上位.reduce((a, t) => a + Math.log(N / (1 + t.世間数)), 0) / 上位.length;
    return { w, 点, 珍しい: 上位 };
  });

  // ★ONE PIECE は Prophecy(2作品) などを持つので上位に来てしまう。
  //   だが ONE PIECE は「前例がない」のではなく「前例そのもの」。
  //   → 知られているものほど下げる（利用者はアーリーアダプタ傾向）
  const 人気順 = [...候補].sort((a, b) => (a.人気 | 0) - (b.人気 | 0)).map((w) => w.id);
  const 位置 = new Map(人気順.map((id, i) => [id, 候補.length > 1 ? i / (候補.length - 1) : 0]));
  const 係数 = 人気の扱い === 'マイナーを上に' ? 0.45 : 0;

  const 最大 = Math.max(...raw.map((r) => r.点), 0.0001);
  return raw
    .filter((r) => r.珍しい.length && r.珍しい[0].世間数 <= 40)   // いちばん珍しい言葉が40作品以下
    .map((r) => {
      const p = 位置.get(r.w.id) ?? 0.5;
      const 生 = (r.点 / 最大) * 100;
      return {
        w: r.w,
        点: Math.max(0, Math.round(生 * (1 - 係数 * p))),
        珍しい: r.珍しい,
        // ★なぜ前例がないのかを、数字で言う
        理由: r.珍しい.slice(0, 2)
          .map((t) => `〈${訳(t.名前)}〉は世間に${t.世間数}作品だけ`).join('　'),
      };
    })
    .sort((a, b) => b.点 - a.点);
}
