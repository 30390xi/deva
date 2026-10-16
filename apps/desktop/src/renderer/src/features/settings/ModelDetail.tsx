import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, RotateCcw } from 'lucide-react'
import { useI18n } from '../../i18n/i18n'
import type { ModelDef, Provider } from '../../mock/models'
import {
  CONTEXT_WINDOW_RANGE,
  MAX_OUTPUT_RANGE,
  autoContextWindow,
  autoOutputBudget,
  formatTokens,
  parseTokens,
  validLimit,
  type LimitAdapter
} from '../../../../shared/context'

/**
 * 模型详情页（设置 › 模型 › 服务商 › 模型）：改模型名称、上下文窗口、最大输出长度。
 * 两项上限留「自动」即走内置表 / 引擎默认（shared/context.ts），主进程每次请求现查，改了即对下一次请求生效。
 */

const CONTEXT_PRESETS = [128_000, 200_000, 256_000, 400_000, 1_000_000]
const OUTPUT_PRESETS = [8_192, 16_384, 32_000, 64_000, 128_000]

interface Props {
  provider: Provider
  model: ModelDef
  onBack: () => void
  onUpdate: (patch: Partial<Pick<ModelDef, 'name' | 'contextWindow' | 'maxOutput'>>) => void
}

export function ModelDetail({ provider, model, onBack, onUpdate }: Props): React.JSX.Element {
  const { t } = useI18n()
  const adapter = provider.adapter as LimitAdapter
  const autoWindow = autoContextWindow(model.id)
  const autoOutput = autoOutputBudget(adapter, model.id)
  const ctxWindow = model.contextWindow ?? autoWindow
  const output = model.maxOutput ?? autoOutput

  const [nameDraft, setNameDraft] = useState(model.name)
  useEffect(() => setNameDraft(model.name), [model.name])

  const commitName = (): void => {
    const v = nameDraft.trim() || model.id
    if (v !== model.name) onUpdate({ name: v })
    setNameDraft(v)
  }

  const customized =
    model.name !== model.id || model.contextWindow !== undefined || model.maxOutput !== undefined

  return (
    <section className="provider-detail model-detail">
      <div className="provider-detail__topbar">
        <button className="provider-detail__back" onClick={onBack}>
          <ChevronLeft size={16} />
          {t('models.backTo').replace('{name}', provider.name)}
        </button>
      </div>

      <div className="field">
        <label className="field__label">{t('models.displayName')}</label>
        <div className="field__control">
          <input
            className="input"
            type="text"
            value={nameDraft}
            placeholder={model.id}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </div>
        <p className="field__note">{t('models.displayNameHint').replace('{id}', model.id)}</p>
      </div>

      <LimitField
        label={t('models.contextWindow')}
        autoText={formatTokens(autoWindow)}
        value={model.contextWindow}
        presets={CONTEXT_PRESETS}
        range={CONTEXT_WINDOW_RANGE}
        note={t('models.contextWindowHint')}
        check={(n) =>
          output !== undefined && n <= output
            ? t('models.windowTooSmall').replace('{n}', formatTokens(output))
            : null
        }
        onChange={(v) => onUpdate({ contextWindow: v })}
      />

      <LimitField
        label={t('models.maxOutput')}
        autoText={autoOutput !== undefined ? formatTokens(autoOutput) : t('models.providerDefault')}
        value={model.maxOutput}
        presets={OUTPUT_PRESETS}
        range={MAX_OUTPUT_RANGE}
        note={t('models.maxOutputHint')}
        check={(n) =>
          n >= ctxWindow ? t('models.outputTooLarge').replace('{n}', formatTokens(ctxWindow)) : null
        }
        onChange={(v) => onUpdate({ maxOutput: v })}
      />

      {customized && (
        <div className="model-detail__reset">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              onUpdate({ name: model.id, contextWindow: undefined, maxOutput: undefined })
              setNameDraft(model.id)
            }}
          >
            <RotateCcw size={13} />
            {t('models.resetModel')}
          </button>
        </div>
      )}
    </section>
  )
}

interface LimitFieldProps {
  label: string
  /** 「自动」档显示的值（如 1M / 服务商默认）。 */
  autoText: string
  /** 用户填写的值；undefined = 自动。 */
  value: number | undefined
  presets: number[]
  range: { min: number; max: number }
  note: string
  /** 与另一项上限的交叉校验：返回错误文案即拒绝保存。 */
  check: (n: number) => string | null
  onChange: (v: number | undefined) => void
}

/** 一项 token 上限：「自动 / 自定义」两档；自定义时可输入（支持 200K / 1M 写法）或点常用档位，失焦 / 回车保存。 */
function LimitField({
  label,
  autoText,
  value,
  presets,
  range,
  note,
  check,
  onChange
}: LimitFieldProps): React.JSX.Element {
  const { t } = useI18n()
  const show = (n: number | undefined): string => (n === undefined ? '' : n.toLocaleString('en-US'))
  const [custom, setCustom] = useState(value !== undefined)
  const [draft, setDraft] = useState(show(value))
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 保存后（或「恢复默认」）以存下的值为准：200k 之类的写法回显成规范数字。
  useEffect(() => {
    setCustom(value !== undefined)
    setDraft(show(value))
    setError('')
  }, [value])

  const commit = (raw: string): void => {
    // 清空即回到自动。
    if (!raw.trim()) {
      setError('')
      setCustom(false)
      if (value !== undefined) onChange(undefined)
      return
    }
    const n = parseTokens(raw)
    if (n === null || !validLimit(n, range)) {
      setError(
        t('models.limitInvalid')
          .replace('{min}', formatTokens(range.min))
          .replace('{max}', formatTokens(range.max))
      )
      return
    }
    const msg = check(n)
    if (msg) {
      setError(msg)
      return
    }
    setError('')
    if (n !== value) onChange(n)
    else setDraft(show(n))
  }

  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <div className="segmented">
        <button
          type="button"
          className={`segmented__item${custom ? '' : ' is-active'}`}
          onClick={() => {
            setCustom(false)
            setError('')
            setDraft('')
            if (value !== undefined) onChange(undefined)
          }}
        >
          {t('models.limitAuto').replace('{v}', autoText)}
        </button>
        <button
          type="button"
          className={`segmented__item${custom ? ' is-active' : ''}`}
          onClick={() => {
            if (custom) return
            setCustom(true)
            // 等输入框挂载后再聚焦
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
        >
          {t('models.limitCustom')}
        </button>
      </div>

      {custom && (
        <>
          <div className="field__control model-limit__input">
            <input
              ref={inputRef}
              className="input"
              type="text"
              inputMode="numeric"
              value={draft}
              placeholder={t('models.limitPlaceholder')}
              onChange={(e) => {
                setDraft(e.target.value)
                setError('')
              }}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
            <span className="model-limit__unit">tokens</span>
          </div>
          <div className="model-limit__presets">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                className={`model-limit__preset${p === value ? ' is-active' : ''}`}
                // onMouseDown 先于 input blur：避免先按草稿保存一次再按档位保存
                onMouseDown={(e) => {
                  e.preventDefault()
                  setDraft(show(p))
                  commit(String(p))
                }}
              >
                {formatTokens(p)}
              </button>
            ))}
          </div>
        </>
      )}

      {error && <div className="field__warn">{error}</div>}
      <p className="field__note">{note}</p>
    </div>
  )
}
