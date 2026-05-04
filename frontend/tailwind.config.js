/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: ["'DM Sans'", '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
  			mono: ["'JetBrains Mono'", "'DM Mono'", 'ui-monospace', 'SFMono-Regular', 'monospace'],
  		},
  		colors: {
  			// Vercel-style gray scale - works in both light and dark
  			gray: {
  				50: '#fafafa',
  				100: '#f5f5f5',
  				200: '#e5e5e5',
  				300: '#d4d4d4',
  				400: '#a3a3a3',
  				500: '#737373',
  				600: '#525252',
  				700: '#404040',
  				800: '#262626',
  				900: '#171717',
  				950: '#0a0a0a'
  			},
  			// shadcn/ui v3 - OKLCH color system
  			// CSS variables contain full oklch() values, so we reference directly
  			border: 'var(--border)',
  			input: 'var(--input)',
  			ring: 'var(--ring)',
  			background: 'var(--background)',
  			foreground: 'var(--foreground)',
  			primary: {
  				DEFAULT: 'var(--primary)',
  				foreground: 'var(--primary-foreground)'
  			},
  			secondary: {
  				DEFAULT: 'var(--secondary)',
  				foreground: 'var(--secondary-foreground)'
  			},
  			destructive: {
  				DEFAULT: 'var(--destructive)',
  				foreground: 'var(--destructive-foreground)'
  			},
  			muted: {
  				DEFAULT: 'var(--muted)',
  				foreground: 'var(--muted-foreground)'
  			},
  			accent: {
  				DEFAULT: 'var(--accent)',
  				foreground: 'var(--accent-foreground)'
  			},
  			popover: {
  				DEFAULT: 'var(--popover)',
  				foreground: 'var(--popover-foreground)'
  			},
  			card: {
  				DEFAULT: 'var(--card)',
  				foreground: 'var(--card-foreground)'
  			},
  			// Semantic colors for status indicators
  			success: {
  				DEFAULT: 'var(--success)',
  				foreground: 'oklch(1 0 0)'
  			},
  			warning: {
  				DEFAULT: 'var(--warning)',
  				foreground: 'oklch(0.2 0 0)'
  			},
  			info: {
  				DEFAULT: 'var(--info)',
  				foreground: 'oklch(1 0 0)'
  			},
  			// Chart colors
  			chart: {
  				1: 'var(--chart-1)',
  				2: 'var(--chart-2)',
  				3: 'var(--chart-3)',
  				4: 'var(--chart-4)',
  				5: 'var(--chart-5)'
  			},
  			// Sidebar colors
  			sidebar: {
  				DEFAULT: 'var(--sidebar)',
  				foreground: 'var(--sidebar-foreground)',
  				primary: 'var(--sidebar-primary)',
  				'primary-foreground': 'var(--sidebar-primary-foreground)',
  				accent: 'var(--sidebar-accent)',
  				'accent-foreground': 'var(--sidebar-accent-foreground)',
  				border: 'var(--sidebar-border)',
  				ring: 'var(--sidebar-ring)'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [],
}
