import React, {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useMemo,
  memo
} from 'react'
import type { UseThemeProps, ThemeProviderProps } from './types'

const colorSchemes = ['light', 'dark']
const MEDIA = '(prefers-color-scheme: dark)'
const isServer = typeof window === 'undefined'
const ThemeContext = createContext<UseThemeProps | undefined>(undefined)
const defaultContext: UseThemeProps = { setTheme: _ => {}, themes: [] }

export const useTheme = () => useContext(ThemeContext) ?? defaultContext

export const ThemeProvider: React.FC<ThemeProviderProps> = props => {
  const context = useContext(ThemeContext)

  // Ignore nested context providers, just passthrough children
  if (context) return <Fragment>{props.children}</Fragment>
  return <Theme {...props} />
}

const defaultThemes = ['light', 'dark']

const Theme: React.FC<ThemeProviderProps> = ({
  forcedTheme,
  disableTransitionOnChange = false,
  enableSystem = true,
  enableMultipleSystemThemes = false,
  enableColorScheme = true,
  storageKey = 'theme',
  themes = defaultThemes,
  defaultTheme = enableSystem ? 'system' : 'light',
  attribute = 'data-theme',
  value,
  children,
  nonce
}) => {
  const [theme, setThemeState] = useState(() => getTheme(storageKey, defaultTheme))
  const [resolvedTheme, setResolvedTheme] = useState(() =>
    getResolvedTheme(storageKey, defaultTheme, enableMultipleSystemThemes)
  )

  const defaultColorScheme = useMemo(() => getColorScheme(defaultTheme), [defaultTheme])
  const attrs = value ? Object.values(value) : themes

  const applyTheme = useCallback(theme => {
    let resolved = theme
    if (!resolved) return

    // If theme is system, resolve it before setting theme
    if (enableSystem) {
      if (theme === 'system') {
        resolved = getSystemTheme()
      } else if (enableMultipleSystemThemes && theme.startsWith('system-')) {
        resolved = `${getSystemTheme()}${theme.substring(6)}`
      }
    }

    const name = value ? value[resolved] : resolved
    const enable = disableTransitionOnChange ? disableAnimation() : null
    const d = document.documentElement

    if (attribute === 'class') {
      d.classList.remove(...attrs)
      if (name) d.classList.add(name)
    } else {
      if (name) {
        d.setAttribute(attribute, name)
      } else {
        d.removeAttribute(attribute)
      }
    }

    if (enableColorScheme) {
      // @ts-ignore
      d.style.colorScheme = getColorScheme(resolved, defaultColorScheme)
    }

    enable?.()
  }, [])

  const setTheme = useCallback(theme => {
    setThemeState(theme)

    // Save to storage
    try {
      localStorage.setItem(storageKey, theme)
    } catch (e) {
      // Unsupported
    }
  }, [])

  const handleMediaQuery = useCallback(
    (e: MediaQueryListEvent | MediaQueryList) => {
      const systemTheme = getSystemTheme(e)
      const resolvedTheme =
        enableMultipleSystemThemes && theme?.startsWith('system-')
          ? `${getSystemTheme()}${theme.substring(6)}`
          : systemTheme
      setResolvedTheme(resolvedTheme)

      if (
        !forcedTheme &&
        enableSystem &&
        (theme === 'system' || (enableMultipleSystemThemes && theme?.startsWith('system-')))
      ) {
        applyTheme(theme)
      }
    },
    [theme, forcedTheme]
  )

  // Always listen to System preference
  useEffect(() => {
    const media = window.matchMedia(MEDIA)

    // Intentionally use deprecated listener methods to support iOS & old browsers
    media.addListener(handleMediaQuery)
    handleMediaQuery(media)

    return () => media.removeListener(handleMediaQuery)
  }, [handleMediaQuery])

  // localStorage event handling
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== storageKey) {
        return
      }

      // If default theme set, use it if localstorage === null (happens on local storage manual deletion)
      const theme = e.newValue || defaultTheme
      setTheme(theme)
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [setTheme])

  // Whenever theme or forcedTheme changes, apply it
  useEffect(() => {
    applyTheme(forcedTheme ?? theme)
  }, [forcedTheme, theme])

  const providerThemes = useMemo(() => {
    if (!enableSystem) return themes

    const themeSet = new Set(themes)
    themeSet.add('system')

    if (enableMultipleSystemThemes) {
      const maybeSystemThemes: Record<string, { light?: boolean; dark?: boolean }> = {}
      for (const theme of themes) {
        let key: string | undefined
        if (theme === 'light' || theme === 'dark') key = ''
        if (theme.startsWith('light-') || theme.startsWith('dark-'))
          key = theme.substring(theme.indexOf('-'))
        if (typeof key !== 'string') continue

        let val = maybeSystemThemes[key]
        if (!val) {
          val = {}
          maybeSystemThemes[key] = val
        }
        if (theme === 'light' || theme.startsWith('light-')) val.light = true
        if (theme === 'dark' || theme.startsWith('dark-')) val.dark = true
      }
      const systemThemes = Object.entries(maybeSystemThemes)
        .filter(([_, v]) => v.light && v.dark)
        .map(([k]) => k)
      for (const systemTheme of systemThemes) {
        themeSet.add(`system${systemTheme}`)
      }
    }

    return Array.from(themeSet)
  }, [themes, enableSystem, enableMultipleSystemThemes])

  const providerValue = useMemo(
    () => ({
      theme,
      setTheme,
      forcedTheme,
      resolvedTheme:
        theme === 'system' || (enableMultipleSystemThemes && theme?.startsWith('system-'))
          ? resolvedTheme
          : theme,
      systemTheme: (enableSystem ? resolvedTheme : undefined) as 'light' | 'dark' | undefined,
      themes: providerThemes
    }),
    [theme, setTheme, forcedTheme, resolvedTheme, enableSystem, providerThemes]
  )

  return (
    <ThemeContext.Provider value={providerValue}>
      <ThemeScript
        {...{
          forcedTheme,
          disableTransitionOnChange,
          enableSystem,
          enableMultipleSystemThemes,
          enableColorScheme,
          storageKey,
          themes,
          defaultTheme,
          attribute,
          value,
          children,
          attrs,
          nonce
        }}
      />
      {children}
    </ThemeContext.Provider>
  )
}

const ThemeScript = memo(
  ({
    forcedTheme,
    storageKey,
    attribute,
    enableSystem,
    enableColorScheme,
    defaultTheme,
    value,
    attrs,
    nonce
  }: ThemeProviderProps & { attrs: string[]; defaultTheme: string }) => {
    const defaultSystem = defaultTheme === 'system'

    // Code-golfing the amount of characters in the script
    const optimization = (() => {
      if (attribute === 'class') {
        const removeClasses = `c.remove(${attrs.map((t: string) => `'${t}'`).join(',')})`

        return `var d=document.documentElement,c=d.classList;${removeClasses};`
      } else {
        return `var d=document.documentElement,n='${attribute}',s='setAttribute';`
      }
    })()

    const fallbackColorScheme = (() => {
      if (!enableColorScheme) {
        return ''
      }

      const fallback = colorSchemes.includes(defaultTheme) ? defaultTheme : null

      if (fallback) {
        return `if(e==='light'||e==='dark'||!e)d.style.colorScheme=e||'${defaultTheme}'`
      } else {
        return `if(e==='light'||e==='dark')d.style.colorScheme=e`
      }
    })()

    const updateDOM = (name: string, literal: boolean = false, setColorScheme = true) => {
      const resolvedName = value ? value[name] : name
      const val = literal ? name + `|| ''` : `'${resolvedName}'`
      let text = ''

      // MUCH faster to set colorScheme alongside HTML attribute/class
      // as it only incurs 1 style recalculation rather than 2
      // This can save over 250ms of work for pages with big DOM
      if (enableColorScheme && setColorScheme && !literal && colorSchemes.includes(name)) {
        text += `d.style.colorScheme = '${name}';`
      }

      if (attribute === 'class') {
        if (literal || resolvedName) {
          text += `c.add(${val})`
        } else {
          text += `null`
        }
      } else {
        if (resolvedName) {
          text += `d[s](n,${val})`
        }
      }

      return text
    }

    const scriptSrc = (() => {
      if (forcedTheme) {
        return `!function(){${optimization}${updateDOM(forcedTheme)}}()`
      }

      if (enableSystem) {
        return `!function(){try{${optimization}var e=localStorage.getItem('${storageKey}');if('system'===e||(!e&&${defaultSystem})){var t='${MEDIA}',m=window.matchMedia(t);if(m.media!==t||m.matches){${updateDOM(
          'dark'
        )}}else{${updateDOM('light')}}}else if(e){${
          value ? `var x=${JSON.stringify(value)};` : ''
        }${updateDOM(value ? `x[e]` : 'e', true)}}${
          !defaultSystem ? `else{` + updateDOM(defaultTheme, false, false) + '}' : ''
        }${fallbackColorScheme}}catch(e){}}()`
      }

      return `!function(){try{${optimization}var e=localStorage.getItem('${storageKey}');if(e){${
        value ? `var x=${JSON.stringify(value)};` : ''
      }${updateDOM(value ? `x[e]` : 'e', true)}}else{${updateDOM(
        defaultTheme,
        false,
        false
      )};}${fallbackColorScheme}}catch(t){}}();`
    })()

    return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: scriptSrc }} />
  },
  // Never re-render this component
  () => true
)

// Helpers
const getTheme = (key: string, fallback?: string) => {
  if (isServer) return undefined
  let theme
  try {
    theme = localStorage.getItem(key) || undefined
  } catch (e) {
    // Unsupported
  }
  return theme || fallback
}

const getResolvedTheme = (key: string, fallback?: string, enableMultipleSystemThemes?: boolean) => {
  const theme = getTheme(key, fallback)
  if (!theme) return undefined
  if (theme === 'system') return getSystemTheme()
  if (enableMultipleSystemThemes && theme.startsWith('system-'))
    return `${getSystemTheme()}${theme.substring(6)}`
  return theme
}

const getColorScheme = (theme: string, fallback: 'light' | 'dark' | null = null) => {
  if (theme === 'light' || theme.startsWith('light-')) return 'light'
  if (theme === 'dark' || theme.startsWith('dark-')) return 'dark'
  return colorSchemes.includes(theme) ? theme : fallback
}

const disableAnimation = () => {
  const css = document.createElement('style')
  css.appendChild(
    document.createTextNode(
      `*{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}`
    )
  )
  document.head.appendChild(css)

  return () => {
    // Force restyle
    ;(() => window.getComputedStyle(document.body))()

    // Wait for next tick before removing
    setTimeout(() => {
      document.head.removeChild(css)
    }, 1)
  }
}

const getSystemTheme = (e?: MediaQueryList | MediaQueryListEvent) => {
  if (!e) e = window.matchMedia(MEDIA)
  const isDark = e.matches
  const systemTheme = isDark ? 'dark' : 'light'
  return systemTheme
}
