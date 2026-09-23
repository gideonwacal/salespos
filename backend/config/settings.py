"""Django settings for the SalesPos backend."""

from datetime import timedelta
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv
import os

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_list(name: str, default: str = "") -> list[str]:
    # A variable that is *set but empty* must fall back to the default too. An
    # empty ALLOWED_HOSTS makes Django answer 400 to every request, which is a
    # miserable thing to debug.
    raw = os.environ.get(name) or default
    return [item.strip() for item in raw.split(",") if item.strip()]


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "insecure-dev-key-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

# Render sets this to the service's public hostname. Trusting it directly is
# more reliable than wiring the hostname through the blueprint, which cannot
# reference the service being created.
RENDER_HOST = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
if RENDER_HOST and RENDER_HOST not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(RENDER_HOST)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "django_filters",
    "corsheaders",
    "apps.core",
    "apps.accounts",
    "apps.inventory",
    "apps.sales",
    "apps.expenses",
    "apps.trade",
    "apps.console",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # Serves the admin and DRF assets straight from gunicorn. Free hosts give
    # you no nginx in front, so without this the admin loads unstyled.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Last, so it sees the final response and the user DRF authenticated.
    "apps.console.middleware.ActivityLogMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": dj_database_url.parse(
        os.environ.get(
            "DATABASE_URL", "postgres://postgres:postgres@localhost:5432/pamojahub"
        ),
        conn_max_age=600,
    )
}

# A relative sqlite path in DATABASE_URL is relative to backend/, not to whatever
# directory the server was started from.
if DATABASES["default"]["ENGINE"].endswith("sqlite3"):
    name = Path(DATABASES["default"]["NAME"])
    if not name.is_absolute():
        DATABASES["default"]["NAME"] = str(BASE_DIR / name)

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
# collectstatic needs somewhere to put things; a deploy that skips this leaves
# the Django admin without its CSS.
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
    },
}
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.DefaultPagination",
    "PAGE_SIZE": 200,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=int(os.environ.get("JWT_ACCESS_MINUTES", "60"))
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        days=int(os.environ.get("JWT_REFRESH_DAYS", "14"))
    ),
    "ROTATE_REFRESH_TOKENS": True,
    "UPDATE_LAST_LOGIN": True,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# 8080 is the shop app (`npm run dev`), 8090 the platform console; 3000/5173 are
# Vite's other common ports.
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:8080,http://localhost:8090,http://localhost:3000,http://localhost:5173",
)
# The browser posts to a different origin in production, so the CSRF check
# needs to know which fronts are trusted. Same list as CORS, https only.
CSRF_TRUSTED_ORIGINS = [o for o in CORS_ALLOWED_ORIGINS if o.startswith("https://")]

if not DEBUG:
    # Behind a platform proxy (Render, Fly, Railway) Django only learns the
    # request was HTTPS from this header.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = os.environ.get("DJANGO_SSL_REDIRECT", "1") == "1"
    # The platform polls the health check internally over plain http. Without
    # this exemption Django answers 301, the check never sees a 2xx, and the
    # deploy is marked failed even though the app is fine.
    SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    # Off by default: HSTS tells browsers to refuse http for this domain for
    # months, which is painful to undo. Turn it on once https is settled.
    SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_HSTS_SECONDS", "0"))
    if SECURE_HSTS_SECONDS:
        SECURE_HSTS_INCLUDE_SUBDOMAINS = True
        SECURE_HSTS_PRELOAD = True

CORS_ALLOW_HEADERS = (
    "accept",
    "authorization",
    "content-type",
    "origin",
    "user-agent",
    "x-workspace",
)

# Where shops send their monthly subscription. Shown on the billing page; each
# payment is confirmed by hand in the Django admin before the plan activates.
#
# The number is read only from the environment (backend/.env locally, a secret
# env var on the host) so it never lands in git or in the browser bundle. A
# value that isn't a real MTN Uganda line is dropped rather than shown to
# paying shops, so a typo can't send their money to a stranger.
SUBSCRIPTION_MOMO_NETWORK = "MTN Mobile Money"

MTN_UG_PREFIXES = {"076", "077", "078", "079", "039"}
AIRTEL_UG_PREFIXES = {"070", "074", "075", "020"}


def ug_number(raw: str, prefixes: set) -> str:
    """Format a Ugandan mobile number, or return "" if it is not one of these.

    A number that fails this check is dropped rather than shown, so a typo in
    an environment variable cannot send a shop's subscription to a stranger.
    """
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits.startswith("256"):
        digits = "0" + digits[3:]
    if len(digits) == 10 and digits[:3] in prefixes:
        return f"{digits[:4]} {digits[4:7]} {digits[7:]}"
    return ""


def mtn_uganda_number(raw: str) -> str:
    return ug_number(raw, MTN_UG_PREFIXES)


def airtel_uganda_number(raw: str) -> str:
    return ug_number(raw, AIRTEL_UG_PREFIXES)


SUBSCRIPTION_MOMO_NUMBER = mtn_uganda_number(os.environ.get("SUBSCRIPTION_MOMO_NUMBER", ""))
SUBSCRIPTION_MOMO_NAME = os.environ.get("SUBSCRIPTION_MOMO_NAME", "").strip()

# Airtel Money, for the half of the country that is not on MTN. Optional: a
# channel with no number set simply is not offered.
SUBSCRIPTION_AIRTEL_NUMBER = airtel_uganda_number(
    os.environ.get("SUBSCRIPTION_AIRTEL_NUMBER", "")
)
SUBSCRIPTION_AIRTEL_NAME = os.environ.get("SUBSCRIPTION_AIRTEL_NAME", "").strip()

# Bank transfer, which is also how a card pays: there is no card gateway behind
# SalesPos, so a shop paying by card moves the money to this account from its
# own bank or card app, and the reference is what ties it back to the shop.
SUBSCRIPTION_BANK_NAME = os.environ.get("SUBSCRIPTION_BANK_NAME", "").strip()
SUBSCRIPTION_BANK_ACCOUNT_NAME = os.environ.get("SUBSCRIPTION_BANK_ACCOUNT_NAME", "").strip()
SUBSCRIPTION_BANK_ACCOUNT_NUMBER = os.environ.get(
    "SUBSCRIPTION_BANK_ACCOUNT_NUMBER", ""
).strip()
SUBSCRIPTION_BANK_BRANCH = os.environ.get("SUBSCRIPTION_BANK_BRANCH", "").strip()

# Card payments through Stripe Checkout.
#
# Stripe hosts the card form, so no card number ever touches this server or the
# browser bundle, and 3-D Secure, Apple Pay and Google Pay come with it. The
# card channel only appears on the billing page once a secret key is set.
#
# The webhook secret is separate and just as required: without it a stranger
# could POST a "payment succeeded" event and activate their own plan for free.
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "").strip()
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()

# Where Stripe sends the shop back to. The billing page reads the result from
# the query string; falling back to the first allowed origin means a normal
# deployment needs no extra setting.
APP_BASE_URL = os.environ.get("APP_BASE_URL", "").strip().rstrip("/")
if not APP_BASE_URL and CORS_ALLOWED_ORIGINS:
    APP_BASE_URL = CORS_ALLOWED_ORIGINS[0].rstrip("/")

# Shillings have no minor unit, and Stripe agrees: UGX is one of its
# zero-decimal currencies, so an amount is sent as whole shillings rather than
# multiplied by 100. Getting this wrong overcharges a shop a hundredfold.
STRIPE_ZERO_DECIMAL_CURRENCIES = {
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
    "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
}


# The helper that uses this lives in apps.accounts.views: django.conf.settings
# only exposes UPPERCASE names, so a function defined here would be invisible
# to anything reading it through `settings.`.

# Rate limits on the billing endpoints: enough for a real shop, too few to
# scrape the payment number or flood the admin with made-up transaction IDs.
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {
    "login": "10/minute",
    "billing_info": "20/hour",
    "payment_submit": "10/day",
}
