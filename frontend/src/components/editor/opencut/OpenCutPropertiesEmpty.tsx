import React from 'react'
import { SlidersHorizontal } from 'lucide-react'

/** OpenCut properties/empty-view.tsx */
const OpenCutPropertiesEmpty: React.FC = () => (
  <div className="oc-properties-empty">
    <SlidersHorizontal size={40} strokeWidth={1} className="oc-properties-empty__icon" />
    <div className="oc-properties-empty__text">
      <p className="oc-properties-empty__title">暂无选中元素</p>
      <p className="oc-properties-empty__hint">点击时间线上的片段或文本层以编辑属性</p>
    </div>
  </div>
)

export default OpenCutPropertiesEmpty
