import { createTheme } from '@mui/material/styles'

export const appTheme = createTheme({
  cssVariables: true,
  palette: {
    primary: { main: '#0b57d0', dark: '#0842a0', light: '#d3e3fd', contrastText: '#ffffff' },
    secondary: { main: '#006d77' },
    background: { default: '#f8fafd', paper: '#ffffff' },
    text: { primary: '#202124', secondary: '#5f6368' },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily: 'Inter, "Noto Sans JP", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontSize: 'clamp(2rem, 5vw, 3.25rem)', fontWeight: 700, letterSpacing: '-0.04em' },
    h2: { fontWeight: 650, letterSpacing: '-0.025em' },
    button: { fontWeight: 700, textTransform: 'none' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 999, minHeight: 44, paddingInline: 20 } },
    },
    MuiCard: {
      styleOverrides: { root: { border: '1px solid #e1e7f0', boxShadow: '0 1px 2px rgb(60 64 67 / 0.08)' } },
    },
    MuiPaper: {
      styleOverrides: { rounded: { borderRadius: 20 } },
    },
  },
})
