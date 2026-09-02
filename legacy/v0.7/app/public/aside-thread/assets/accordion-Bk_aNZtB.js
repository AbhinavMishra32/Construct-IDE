!(function () {
  try {
    var e =
        "undefined" != typeof window
          ? window
          : "undefined" != typeof global
            ? global
            : "undefined" != typeof globalThis
              ? globalThis
              : "undefined" != typeof self
                ? self
                : {},
      n = new e.Error().stack;
    n &&
      ((e._posthogChunkIds = e._posthogChunkIds || {}),
      (e._posthogChunkIds[n] = "019f4f14-67aa-7e63-b34b-b266818eb4ef"));
  } catch (e) {}
})();
import { $ as pe, J as me, K as ge } from "./browser-color-scheme-CWUx8WNZ.js";
import {
  Et as he,
  Ot as re,
  Wt as ve,
  zt as ye,
} from "./usePositioner-CkRTFIki.js";
import { t as xe } from "./chevron-down-medium-DZDJtBro.js";
import { t as G } from "./dist-Bj2HqGuI.js";
import {
  E as Se,
  G as B,
  W as Z,
  d as be,
  l as V,
  n as Y,
  o as Ce,
  r as $,
  t as Pe,
  u as se,
} from "./DirectionContext-DlxyVv1C.js";
import {
  a as Re,
  c as Me,
  i as Ae,
  o as te,
  s as Oe,
  u as z,
} from "./extension-page-url-BknRQN8I.js";
import { t as Ie } from "./useButton-B8aKREGy.js";
import { t as ie } from "./useControlled-XGLJBZAP.js";
import { r as Ne, t as we } from "./CompositeList-CA1zNTW4.js";
var o = pe(me(), 1),
  ae = o.createContext(void 0);
function ue() {
  const e = o.useContext(ae);
  if (e === void 0) throw new Error(Z(10));
  return e;
}
var T = ge(),
  Ee = { value: () => null },
  Te = o.forwardRef(function (t, r) {
    const {
        render: p,
        className: a,
        disabled: n = !1,
        hiddenUntilFound: l,
        keepMounted: s,
        loopFocus: A,
        onValueChange: S,
        multiple: c = !1,
        orientation: u = "vertical",
        value: m,
        defaultValue: b,
        style: w,
        ...O
      } = t,
      g = Pe(),
      y = o.useMemo(() => {
        if (m === void 0) return b ?? [];
      }, [m, b]),
      C = o.useRef([]),
      [h, v] = ie({
        controlled: m,
        default: y,
        name: "Accordion",
        state: "value",
      }),
      I = V((P, E, R) => {
        if (c)
          if (E) {
            const f = h.slice();
            if ((f.push(P), S?.(f, R), R.isCanceled)) return;
            v(f);
          } else {
            const f = h.filter((k) => k !== P);
            if ((S?.(f, R), R.isCanceled)) return;
            v(f);
          }
        else {
          const f = h[0] === P ? [] : [P];
          if ((S?.(f, R), R.isCanceled)) return;
          v(f);
        }
      }),
      d = o.useMemo(
        () => ({ value: h, disabled: n, orientation: u }),
        [h, n, u],
      ),
      _ = o.useMemo(
        () => ({
          disabled: n,
          handleValueChange: I,
          hiddenUntilFound: l ?? !1,
          keepMounted: s ?? !1,
          state: d,
          value: h,
        }),
        [n, I, l, s, d, h],
      ),
      F = $("div", t, {
        state: d,
        ref: r,
        props: [{ dir: g }, O],
        stateAttributesMapping: Ee,
      });
    return (0, T.jsx)(ae.Provider, {
      value: _,
      children: (0, T.jsx)(we, { elementsRef: C, children: F }),
    });
  });
function je(e) {
  const { open: t, defaultOpen: r, onOpenChange: p, disabled: a } = e,
    [n, l] = ie({
      controlled: t,
      default: r,
      name: "Collapsible",
      state: "open",
    }),
    { mounted: s, setMounted: A, transitionStatus: S } = Me(n, !0, !0),
    c = Y(),
    [u, m] = o.useState(),
    b = u ?? c,
    w = V((O) => {
      const g = !n,
        y = re(ve, O.nativeEvent);
      (p(g, y), !y.isCanceled && l(g));
    });
  return o.useMemo(
    () => ({
      disabled: a,
      handleTrigger: w,
      mounted: s,
      open: n,
      panelId: b,
      setMounted: A,
      setOpen: l,
      setPanelIdState: m,
      transitionStatus: S,
    }),
    [a, w, s, n, b, A, l, m, S],
  );
}
var ce = o.createContext(void 0);
function de() {
  const e = o.useContext(ce);
  if (e === void 0) throw new Error(Z(15));
  return e;
}
var le = o.createContext(void 0);
function Q() {
  const e = o.useContext(le);
  if (e === void 0) throw new Error(Z(9));
  return e;
}
var X = (function (e) {
    return (
      (e.open = "data-open"),
      (e.closed = "data-closed"),
      (e[(e.startingStyle = te.startingStyle)] = "startingStyle"),
      (e[(e.endingStyle = te.endingStyle)] = "endingStyle"),
      e
    );
  })({}),
  _e = (function (e) {
    return ((e.panelOpen = "data-panel-open"), e);
  })({}),
  Fe = { [X.open]: "" },
  ke = { [X.closed]: "" },
  De = {
    open(e) {
      return e ? { [_e.panelOpen]: "" } : null;
    },
  },
  Le = {
    open(e) {
      return e ? Fe : ke;
    },
  },
  Ve = (function (e) {
    return (
      (e.index = "data-index"),
      (e.disabled = "data-disabled"),
      (e.open = "data-open"),
      e
    );
  })({}),
  ee = {
    ...Le,
    index: (e) => (Number.isInteger(e) ? { [Ve.index]: String(e) } : null),
    ...Oe,
    value: () => null,
  },
  Ue = o.forwardRef(function (t, r) {
    const {
        className: p,
        disabled: a = !1,
        onOpenChange: n,
        render: l,
        value: s,
        style: A,
        ...S
      } = t,
      { ref: c, index: u } = Ne(),
      m = se(r, c),
      { disabled: b, handleValueChange: w, state: O, value: g } = ue(),
      y = Y(),
      C = s ?? y,
      h = a || b,
      v = o.useMemo(() => {
        if (!g) return !1;
        for (let M = 0; M < g.length; M += 1) if (g[M] === C) return !0;
        return !1;
      }, [g, C]),
      I = V((M, j) => {
        (n?.(M, j), !j.isCanceled && w(C, M, j));
      }),
      d = je({ open: v, onOpenChange: I, disabled: h }),
      _ = o.useMemo(
        () => ({
          open: d.open,
          disabled: d.disabled,
          transitionStatus: d.transitionStatus,
        }),
        [d.open, d.disabled, d.transitionStatus],
      ),
      F = o.useMemo(() => ({ ...d, onOpenChange: I, state: _ }), [d, _, I]),
      P = o.useMemo(
        () => ({
          ...O,
          hidden: !v && !d.mounted,
          index: u,
          disabled: h,
          open: v,
        }),
        [d.mounted, h, u, v, O],
      ),
      E = Y(),
      [R, f] = o.useState(),
      k = o.useMemo(
        () => ({ open: v, state: P, setTriggerId: f, triggerId: R ?? E }),
        [E, v, P, f, R],
      ),
      N = $("div", t, {
        state: P,
        ref: m,
        props: S,
        stateAttributesMapping: ee,
      });
    return (0, T.jsx)(ce.Provider, {
      value: F,
      children: (0, T.jsx)(le.Provider, { value: k, children: N }),
    });
  }),
  He = o.forwardRef(function (t, r) {
    const { render: p, className: a, style: n, ...l } = t,
      { state: s } = Q();
    return $("h3", t, {
      state: s,
      ref: r,
      props: l,
      stateAttributesMapping: ee,
    });
  }),
  We = o.forwardRef(function (t, r) {
    const {
        disabled: p,
        className: a,
        id: n,
        render: l,
        nativeButton: s = !0,
        style: A,
        ...S
      } = t,
      { panelId: c, open: u, handleTrigger: m, disabled: b } = de(),
      { getButtonProps: w, buttonRef: O } = Ie({
        disabled: p || b,
        focusableWhenDisabled: !0,
        native: s,
      }),
      { state: g, setTriggerId: y, triggerId: C } = Q();
    return (
      B(
        () => (
          n && y(n),
          () => {
            y(void 0);
          }
        ),
        [n, y],
      ),
      $("button", t, {
        state: g,
        ref: [r, O],
        props: [
          {
            "aria-controls": u ? c : void 0,
            "aria-expanded": u,
            id: C,
            onClick: m,
          },
          S,
          w,
        ],
        stateAttributesMapping: De,
      })
    );
  }),
  H = { height: void 0, width: void 0 };
function Be(e) {
  const {
      externalRef: t,
      hiddenUntilFound: r,
      id: p,
      keepMounted: a,
      mounted: n,
      onOpenChange: l,
      open: s,
      setMounted: A,
      setOpen: S,
      transitionStatus: c,
    } = e,
    u = o.useRef(null),
    m = o.useRef(null),
    [b, w] = o.useState(H),
    O = o.useRef(H),
    g = o.useRef(!1),
    y = o.useRef(s),
    C = o.useRef(!1),
    [h, v] = o.useState(!1),
    I = o.useRef(null),
    d = se(t, u),
    _ = he({ mounted: n, open: s }),
    F = Re(u, !1, !1),
    P = !s && !n,
    E = h ? "idle" : c,
    R = s && (y.current || C.current),
    f =
      !s &&
      n &&
      m.current === "css-animation" &&
      b.height === void 0 &&
      b.width === void 0
        ? O.current
        : b,
    k = r && P && m.current !== "css-animation",
    N = V((i, x = !0) => {
      (x && (O.current = i), w(i));
    }),
    M = V(() => {
      (I.current?.(), (I.current = null));
    }),
    j = V((i) => {
      (M(),
        (I.current = () => {
          ((I.current = null), i());
        }));
    }),
    q = V(() => {
      s && n && m.current === "css-animation" && (C.current = !0);
    });
  (B(() => {
    !h || c === "starting" || v(!1);
  }, [h, c]),
    o.useEffect(
      () => () => {
        (q(), M());
      },
      [q, M],
    ),
    B(() => {
      const i = u.current;
      if (!i) return;
      !s && I.current && M();
      const x = $e(i, R);
      if (
        ((m.current = x),
        s && c === "idle" && y.current && x === "css-animation")
      ) {
        O.current = U(i);
        return;
      }
      if (s && c === "starting") {
        const K = g.current;
        if (((g.current = !1), x === "none")) {
          (N(U(i)), v(!0));
          return;
        }
        if (x === "css-transition") {
          const L = qe(i);
          if ((N(U(i)), !K)) return L;
          const J = W(i, "transition-duration", "0s");
          return (j(J), v(!0), L);
        }
        if (x === "css-animation") {
          if ((N(U(i)), !K)) {
            W(i, "animation-name", "none")();
            return;
          }
          const L = W(i, "animation-name", "none"),
            J = W(i, "animation-duration", "0s");
          (L(), j(J), v(!0));
          return;
        }
      }
      if (!s && n && (c === "idle" || c === "starting")) {
        if (((y.current = !1), (C.current = !1), x === "none")) {
          (N(H, !1), A(!1));
          return;
        }
        N(U(i));
        return;
      }
      if (c !== "ending") return;
      if (x === "none") {
        A(!1);
        return;
      }
      const D = U(i);
      if (!((D.height ?? 0) > 0 || (D.width ?? 0) > 0)) {
        A(!1);
        return;
      }
      (N(D), x === "css-animation" && W(i, "animation-name", "none")());
    }, [n, s, M, N, A, j, R, c]),
    Ae({
      enabled: s && n && E === "idle",
      open: !0,
      ref: u,
      onComplete() {
        s && N(H, !1);
      },
    }),
    o.useEffect(() => {
      if (s || !n || E !== "ending" || !u.current) return;
      const i = new AbortController();
      let x = -1;
      function D() {
        _.current.open || (A(!1), N(H, !1));
      }
      return (
        (x = z.request(() => {
          i.signal.aborted || F(D, i.signal);
        })),
        () => {
          (z.cancel(x), i.abort());
        }
      );
    }, [_, n, s, E, F, N, A]),
    B(() => {
      const i = u.current;
      !i || !r || !P || i.setAttribute("hidden", "until-found");
    }, [P, r]),
    o.useEffect(
      function () {
        const x = u.current;
        if (!x) return;
        function D(K) {
          const L = re(ye, K);
          (l(!0, L), !L.isCanceled && ((g.current = !0), S(!0)));
        }
        return be(x, "beforematch", D);
      },
      [l, S],
    ));
  const fe = a || r || n || s;
  return {
    height: f.height,
    props: { ...(k ? { [X.startingStyle]: "" } : void 0), hidden: P, id: p },
    ref: d,
    shouldPreventOpenAnimation: R,
    shouldRender: fe,
    transitionStatus: E,
    width: f.width,
  };
}
function U(e) {
  return { height: e.scrollHeight, width: e.scrollWidth };
}
function $e(e, t = !1) {
  const r = Se(e).getComputedStyle(e),
    p =
      (r.animationName
        .split(",")
        .map((n) => n.trim())
        .some((n) => n !== "" && n !== "none") ||
        t) &&
      ne(r.animationDuration),
    a = ne(r.transitionDuration);
  return (p && a) || a ? "css-transition" : p ? "css-animation" : "none";
}
function ne(e) {
  return e
    .split(",")
    .map((t) => t.trim())
    .some((t) => t !== "" && Number.parseFloat(t) > 0);
}
function W(e, t, r) {
  const p = e.style.getPropertyValue(t),
    a = e.style.getPropertyPriority(t);
  return (
    e.style.setProperty(t, r),
    () => {
      if (p === "") {
        e.style.removeProperty(t);
        return;
      }
      e.style.setProperty(t, p, a);
    }
  );
}
function qe(e) {
  const t = {
    "justify-content": e.style.justifyContent,
    "align-items": e.style.alignItems,
    "align-content": e.style.alignContent,
    "justify-items": e.style.justifyItems,
  };
  Object.keys(t).forEach((a) => {
    e.style.setProperty(a, "initial", "important");
  });
  function r() {
    Object.entries(t).forEach(([a, n]) => {
      if (n === "") {
        e.style.removeProperty(a);
        return;
      }
      e.style.setProperty(a, n);
    });
  }
  const p = z.request(r);
  return () => {
    (z.cancel(p), r());
  };
}
var oe = (function (e) {
    return (
      (e.accordionPanelHeight = "--accordion-panel-height"),
      (e.accordionPanelWidth = "--accordion-panel-width"),
      e
    );
  })({}),
  Ke = o.forwardRef(function (t, r) {
    const {
        className: p,
        hiddenUntilFound: a,
        keepMounted: n,
        id: l,
        render: s,
        style: A,
        ...S
      } = t,
      { hiddenUntilFound: c, keepMounted: u } = ue(),
      {
        mounted: m,
        onOpenChange: b,
        open: w,
        panelId: O,
        setMounted: g,
        setOpen: y,
        setPanelIdState: C,
        transitionStatus: h,
      } = de(),
      v = a ?? c,
      I = n ?? u;
    B(() => {
      if (l)
        return (
          C(l),
          () => {
            C(void 0);
          }
        );
    }, [l, C]);
    const {
        height: d,
        props: _,
        ref: F,
        shouldPreventOpenAnimation: P,
        shouldRender: E,
        transitionStatus: R,
        width: f,
      } = Be({
        externalRef: r,
        hiddenUntilFound: v,
        id: l ?? O,
        keepMounted: I,
        mounted: m,
        onOpenChange: b,
        open: w,
        setMounted: g,
        setOpen: y,
        transitionStatus: h,
      }),
      { state: k, triggerId: N } = Q(),
      M = { ...k, transitionStatus: R },
      j = Ce(A, M),
      q = $(
        "div",
        { ...t, style: void 0 },
        {
          state: M,
          ref: F,
          props: [
            _,
            {
              "aria-labelledby": N,
              role: "region",
              style: {
                [oe.accordionPanelHeight]: d === void 0 ? "auto" : `${d}px`,
                [oe.accordionPanelWidth]: f === void 0 ? "auto" : `${f}px`,
              },
            },
            S,
            j ? { style: j } : void 0,
            P ? { style: { animationName: "none" } } : void 0,
          ],
          stateAttributesMapping: ee,
        },
      );
    return E ? q : null;
  });
function nt({ className: e, ...t }) {
  return (0, T.jsx)(Te, {
    "data-slot": "accordion",
    className: G("flex w-full flex-col", e),
    ...t,
  });
}
function ot({ className: e, ...t }) {
  return (0, T.jsx)(Ue, {
    "data-slot": "accordion-item",
    className: G("not-last:border-b", e),
    ...t,
  });
}
function rt({ className: e, children: t, ...r }) {
  return (0, T.jsx)(He, {
    className: "flex",
    children: (0, T.jsxs)(We, {
      "data-slot": "accordion-trigger",
      className: G(
        "group/accordion-trigger focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:after:border-ring **:data-[slot=accordion-trigger-icon]:text-muted-foreground relative flex flex-1 items-start justify-between rounded-lg border border-transparent py-2.5 text-left text-sm font-medium transition-all outline-none focus-visible:ring-3 aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4",
        e,
      ),
      ...r,
      children: [
        t,
        (0, T.jsx)(xe, {
          "data-slot": "accordion-trigger-icon",
          "data-icon": "inline-end",
          className:
            "text-muted-foreground pointer-events-none shrink-0 transition-transform group-aria-expanded/accordion-trigger:rotate-180",
        }),
      ],
    }),
  });
}
function st({ className: e, children: t, ...r }) {
  return (0, T.jsx)(Ke, {
    "data-slot": "accordion-content",
    className:
      "data-open:animate-accordion-down data-closed:animate-accordion-up overflow-hidden text-sm",
    ...r,
    children: (0, T.jsx)("div", {
      className: G(
        "[&_a]:hover:text-foreground pt-0 pb-2.5 [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        e,
      ),
      children: t,
    }),
  });
}
export {
  Ke as a,
  De as c,
  je as d,
  rt as i,
  ce as l,
  st as n,
  Be as o,
  ot as r,
  Le as s,
  nt as t,
  de as u,
};

//# chunkId=019f4f14-67aa-7e63-b34b-b266818eb4ef
