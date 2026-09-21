/**
 * WidgetThumb —— 组件面板里每个控件的「可视化缩影」。
 * 纯 CSS 绘制(样式见 WidgetThumbs.css),这里只给出每个 type 需要的内部 DOM 骨架。
 * 未列出的 type 走 default(纯伪元素实现,无子节点)。
 * 新增控件:在 MARKUP 里补一条(或纯伪元素则不用补),并在 WidgetThumbs.css 加对应 .wthumb-<type>。
 */
import type { JSX, ReactNode } from 'react';

/** 每个控件缩影的内部结构;纯 ::before/::after 实现的控件不在此表,渲染为空 .wthumb-<type>。 */
const MARKUP: Record<string, ReactNode> = {
  label: <><i /><i /><i /></>,
  spangroup: <><i /><i /><i /></>,
  line: (
    <div className="box">
      <span className="seg s1" /><span className="seg s2" /><span className="seg s3" />
      <span className="dot p1" /><span className="dot p2" /><span className="dot p3" /><span className="dot p4" />
    </div>
  ),
  arclabel: (
    <div className="g">
      <span className="arc" />
      <span className="ch ch1" /><span className="ch ch2" /><span className="ch ch3" />
    </div>
  ),
  slider: <div className="track"><div className="fill" /><div className="knob" /></div>,
  switch: <div className="pill"><div className="dot" /></div>,
  checkbox: <><div className="box" /><div className="tx"><i /><i /></div></>,
  arc: <div className="ring" />,
  dropdown: <div className="field"><div className="caret" /></div>,
  roller: <div className="wheel"><span className="row a" /><span className="row on" /><span className="row b" /></div>,
  textarea: <div className="field"><span className="cur" /></div>,
  spinbox: <><span className="btn" /><span className="num" /><span className="btn plus" /></>,
  buttonmatrix: (
    <div className="grid">
      <span /><span className="on" /><span /><span /><span /><span />
    </div>
  ),
  keyboard: (
    <div className="kb">
      <div className="r"><span /><span /><span /><span /><span /></div>
      <div className="r"><span /><span /><span /><span /></div>
      <div className="r"><span /><span className="space" /><span /></div>
    </div>
  ),
  imagebutton: <div className="frame"><span className="sun" /><span className="mtn" /></div>,
  bar: <div className="track"><div className="fill" /></div>,
  led: <div className="led" />,
  qrcode: <div className="qr" />,
  scale: (
    <div className="g">
      <span className="base" />
      <span className="tk lg" style={{ left: '2px' }} />
      <span className="tk sm" style={{ left: '11px' }} />
      <span className="tk lg" style={{ left: '20px' }} />
      <span className="tk sm" style={{ left: '29px' }} />
      <span className="tk lg" style={{ left: '38px' }} />
      <span className="n" style={{ left: '0px' }} />
      <span className="n" style={{ left: '36px' }} />
    </div>
  ),
  spinner: <div className="sp" />,
  calendar: (
    <div className="cal">
      <div className="hd" />
      <div className="grid">
        <span /><span /><span /><span /><span className="on" /><span /><span /><span /><span /><span /><span /><span />
      </div>
    </div>
  ),
  table: (
    <div className="tb">
      <div className="row hd"><span /><span /><span /></div>
      <div className="row"><span /><span /><span /></div>
      <div className="row"><span /><span /><span /></div>
    </div>
  ),
  obj: <div className="frame" />,
  list: (
    <div className="ls">
      <div className="it"><i /></div>
      <div className="it"><i /></div>
      <div className="it"><i /></div>
    </div>
  ),
  menu: (
    <div className="m">
      <div className="side"><i /><i /><i /></div>
      <div className="body"><i /><i className="on" /><i /></div>
    </div>
  ),
  msgbox: (
    <div className="box">
      <div className="t" /><div className="p" />
      <div className="btns"><span /><span className="pri" /></div>
    </div>
  ),
  win: (
    <div className="w">
      <div className="bar"><i /><span className="ctl" /></div>
      <div className="ct" />
    </div>
  ),
  tabview: (
    <div className="tv">
      <div className="tabs"><span className="on" /><span /><span /></div>
      <div className="ct" />
    </div>
  ),
  tileview: (
    <div className="grid"><span className="on" /><span /><span /><span /></div>
  ),
  chart: <div className="c"><span /><span /><span /><span /></div>,
  image: <div className="pic"><span className="sun" /><span className="hill" /></div>,
  animimage: <div className="pic"><span className="sun" /><span className="hill" /><span className="badge" /></div>,
  canvas: <div className="cv"><span className="stroke1" /><span className="stroke2" /><span className="dot" /></div>,
  lottie: <div className="g"><span className="star" /><span className="sp1" /><span className="sp2" /></div>,
};

/** 渲染某控件的可视化缩影。button 等纯伪元素控件返回空壳。 */
export function WidgetThumb({ type }: { type: string }): JSX.Element {
  return (
    <div className={`wthumb wthumb-${type}`} aria-hidden="true">
      {MARKUP[type] ?? null}
    </div>
  );
}
