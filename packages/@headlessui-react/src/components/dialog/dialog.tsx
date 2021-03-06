// WAI-ARIA: https://www.w3.org/TR/wai-aria-practices-1.2/#dialog_modal
import React, {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useCallback,

  // Types
  ElementType,
  Ref,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  ContextType,
  MutableRefObject,
} from 'react'

import { Props } from '../../types'
import { match } from '../../utils/match'
import { forwardRefWithAs, render, Features, PropsForFeatures } from '../../utils/render'
import { useSyncRefs } from '../../hooks/use-sync-refs'
import { Keys } from '../keyboard'
import { isDisabledReactIssue7711 } from '../../utils/bugs'
import { useId } from '../../hooks/use-id'
import { useFocusTrap } from '../../hooks/use-focus-trap'
import { useInertOthers } from '../../hooks/use-inert-others'
import { Portal } from '../../components/portal/portal'

enum DialogStates {
  Open,
  Closed,
}

interface StateDefinition {
  titleElement: HTMLElement | null
  descriptionElement: HTMLElement | null
}

enum ActionTypes {
  SetTitleElement,
  SetDescriptionElement,
}

type Actions =
  | { type: ActionTypes.SetTitleElement; element: HTMLElement | null }
  | { type: ActionTypes.SetDescriptionElement; element: HTMLElement | null }

let reducers: {
  [P in ActionTypes]: (
    state: StateDefinition,
    action: Extract<Actions, { type: P }>
  ) => StateDefinition
} = {
  [ActionTypes.SetTitleElement](state, action) {
    if (state.titleElement === action.element) return state
    return { ...state, titleElement: action.element }
  },
  [ActionTypes.SetDescriptionElement](state, action) {
    if (state.descriptionElement === action.element) return state
    return { ...state, descriptionElement: action.element }
  },
}

let DialogContext = createContext<
  | [
      {
        dialogState: DialogStates
        close(): void
        setTitle(element: HTMLElement | null): void
        setDescription(element: HTMLElement | null): void
      },
      StateDefinition
    ]
  | null
>(null)
DialogContext.displayName = 'DialogContext'

function useDialogContext(component: string) {
  let context = useContext(DialogContext)
  if (context === null) {
    let err = new Error(`<${component} /> is missing a parent <${Dialog.name} /> component.`)
    if (Error.captureStackTrace) Error.captureStackTrace(err, useDialogContext)
    throw err
  }
  return context
}

function stateReducer(state: StateDefinition, action: Actions) {
  return match(action.type, reducers, state, action)
}

// ---

let DEFAULT_DIALOG_TAG = 'div' as const
interface DialogRenderPropArg {
  open: boolean
}
type DialogPropsWeControl = 'id' | 'role' | 'aria-modal' | 'aria-describedby' | 'aria-labelledby'

let DialogRenderFeatures = Features.RenderStrategy | Features.Static

let DialogRoot = forwardRefWithAs(function Dialog<
  TTag extends ElementType = typeof DEFAULT_DIALOG_TAG
>(
  props: Props<TTag, DialogRenderPropArg, DialogPropsWeControl> &
    PropsForFeatures<typeof DialogRenderFeatures> & {
      open: boolean
      onClose(value: boolean): void
      initialFocus?: MutableRefObject<HTMLElement | null>
    },
  ref: Ref<HTMLDivElement>
) {
  let { open, onClose, initialFocus, ...rest } = props

  let internalDialogRef = useRef<HTMLDivElement | null>(null)
  let dialogRef = useSyncRefs(internalDialogRef, ref)

  // Validations
  let hasOpen = props.hasOwnProperty('open')
  let hasOnClose = props.hasOwnProperty('onClose')
  if (!hasOpen && !hasOnClose) {
    throw new Error(
      `You have to provide an \`open\` and an \`onClose\` prop to the \`Dialog\` component.`
    )
  }

  if (!hasOpen) {
    throw new Error(
      `You provided an \`onClose\` prop to the \`Dialog\`, but forgot an \`open\` prop.`
    )
  }

  if (!hasOnClose) {
    throw new Error(
      `You provided an \`open\` prop to the \`Dialog\`, but forgot an \`onClose\` prop.`
    )
  }

  if (typeof open !== 'boolean') {
    throw new Error(
      `You provided an \`open\` prop to the \`Dialog\`, but the value is not a boolean. Received: ${open}`
    )
  }

  if (typeof onClose !== 'function') {
    throw new Error(
      `You provided an \`onClose\` prop to the \`Dialog\`, but the value is not a function. Received: ${onClose}`
    )
  }

  let dialogState = open ? DialogStates.Open : DialogStates.Closed

  let [state, dispatch] = useReducer(stateReducer, {
    titleElement: null,
    descriptionElement: null,
  } as StateDefinition)

  let close = useCallback(() => onClose(false), [onClose])

  let setTitle = useCallback(
    (element: HTMLElement | null) => dispatch({ type: ActionTypes.SetTitleElement, element }),
    [dispatch]
  )
  let setDescription = useCallback(
    (element: HTMLElement | null) => dispatch({ type: ActionTypes.SetDescriptionElement, element }),
    [dispatch]
  )

  // Handle outside click
  useEffect(() => {
    function handler(event: MouseEvent) {
      let target = event.target as HTMLElement

      if (dialogState !== DialogStates.Open) return
      if (internalDialogRef.current?.contains(target)) return

      close()
    }

    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [dialogState, internalDialogRef, close])

  // Handle `Escape` to close
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (event.key !== Keys.Escape) return
      if (dialogState !== DialogStates.Open) return
      close()
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [close, dialogState])

  // Scroll lock
  useEffect(() => {
    if (dialogState !== DialogStates.Open) return

    let overflow = document.documentElement.style.overflow
    let paddingRight = document.documentElement.style.paddingRight

    let scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

    document.documentElement.style.overflow = 'hidden'
    document.documentElement.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      document.documentElement.style.overflow = overflow
      document.documentElement.style.paddingRight = paddingRight
    }
  }, [dialogState])

  // Trigger close when the FocusTrap gets hidden
  useEffect(() => {
    if (dialogState !== DialogStates.Open) return
    if (!internalDialogRef.current) return

    let observer = new IntersectionObserver(entries => {
      for (let entry of entries) {
        if (
          entry.boundingClientRect.x === 0 &&
          entry.boundingClientRect.y === 0 &&
          entry.boundingClientRect.width === 0 &&
          entry.boundingClientRect.height === 0
        ) {
          close()
        }
      }
    })

    observer.observe(internalDialogRef.current)

    return () => observer.disconnect()
  }, [dialogState, internalDialogRef, close])

  let enabled = props.static ? true : dialogState === DialogStates.Open
  useFocusTrap(internalDialogRef, enabled, { initialFocus })
  useInertOthers(internalDialogRef, enabled)

  let id = `headlessui-dialog-${useId()}`

  let contextBag = useMemo<ContextType<typeof DialogContext>>(
    () => [{ dialogState, close, setTitle, setDescription }, state],
    [dialogState, state, close, setTitle, setDescription]
  )

  let propsBag = useMemo<DialogRenderPropArg>(() => ({ open: dialogState === DialogStates.Open }), [
    dialogState,
  ])
  let propsWeControl = {
    ref: dialogRef,
    id,
    role: 'dialog',
    'aria-modal': dialogState === DialogStates.Open ? true : undefined,
    'aria-labelledby': state.titleElement?.id,
    'aria-describedby': state.descriptionElement?.id,
  }
  let passthroughProps = rest

  return (
    <Portal>
      <DialogContext.Provider value={contextBag}>
        {render(
          { ...passthroughProps, ...propsWeControl },
          propsBag,
          DEFAULT_DIALOG_TAG,
          DialogRenderFeatures,
          dialogState === DialogStates.Open
        )}
      </DialogContext.Provider>
    </Portal>
  )
})

// ---

let DEFAULT_OVERLAY_TAG = 'div' as const
interface OverlayRenderPropArg {
  open: boolean
}
type OverlayPropsWeControl = 'id' | 'aria-hidden' | 'onClick'

let Overlay = forwardRefWithAs(function Overlay<
  TTag extends ElementType = typeof DEFAULT_OVERLAY_TAG
>(props: Props<TTag, OverlayRenderPropArg, OverlayPropsWeControl>, ref: Ref<HTMLDivElement>) {
  let [{ dialogState, close }] = useDialogContext([Dialog.name, Overlay.name].join('.'))
  let overlayRef = useSyncRefs(ref)

  let id = `headlessui-dialog-overlay-${useId()}`

  let handleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isDisabledReactIssue7711(event.currentTarget)) return event.preventDefault()
      close()
    },
    [close]
  )

  let propsBag = useMemo<OverlayRenderPropArg>(
    () => ({ open: dialogState === DialogStates.Open }),
    [dialogState]
  )
  let propsWeControl = {
    ref: overlayRef,
    id,
    'aria-hidden': true,
    onClick: handleClick,
  }
  let passthroughProps = props

  return render({ ...passthroughProps, ...propsWeControl }, propsBag, DEFAULT_OVERLAY_TAG)
})

// ---

let DEFAULT_TITLE_TAG = 'h2' as const
interface TitleRenderPropArg {
  open: boolean
}
type TitlePropsWeControl = 'id' | 'ref'

function Title<TTag extends ElementType = typeof DEFAULT_TITLE_TAG>(
  props: Props<TTag, TitleRenderPropArg, TitlePropsWeControl>
) {
  let [{ dialogState, setTitle }] = useDialogContext([Dialog.name, Title.name].join('.'))

  let id = `headlessui-dialog-title-${useId()}`

  let propsBag = useMemo<TitleRenderPropArg>(() => ({ open: dialogState === DialogStates.Open }), [
    dialogState,
  ])
  let propsWeControl = { ref: setTitle, id }
  let passthroughProps = props

  return render({ ...passthroughProps, ...propsWeControl }, propsBag, DEFAULT_TITLE_TAG)
}

// ---

let DEFAULT_DESCRIPTION_TAG = 'p' as const
interface DescriptionRenderPropArg {
  open: boolean
}
type DescriptionPropsWeControl = 'id' | 'ref'

function Description<TTag extends ElementType = typeof DEFAULT_DESCRIPTION_TAG>(
  props: Props<TTag, DescriptionRenderPropArg, DescriptionPropsWeControl>
) {
  let [{ dialogState, setDescription }] = useDialogContext(
    [Dialog.name, Description.name].join('.')
  )

  let id = `headlessui-dialog-description-${useId()}`

  let propsBag = useMemo<DescriptionRenderPropArg>(
    () => ({ open: dialogState === DialogStates.Open }),
    [dialogState]
  )
  let propsWeControl = { ref: setDescription, id }
  let passthroughProps = props

  return render({ ...passthroughProps, ...propsWeControl }, propsBag, DEFAULT_DESCRIPTION_TAG)
}

// ---

export let Dialog = Object.assign(DialogRoot, { Overlay, Title, Description })
