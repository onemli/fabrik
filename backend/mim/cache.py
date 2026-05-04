# mim/cache.py
#
# Decorator-based cache for MIM Neo4j queries. All cache keys start with "mim:"
# so they can be cleared independently. TTL tiers match how often each data type
# changes: search results are short-lived, class hierarchies barely change at all.
# Cache keys are MD5 hashes of the call arguments (sorted for determinism).

import json
import hashlib
from functools import wraps
from django.core.cache import cache
from django.conf import settings


class MIMCache:
    """Decorator-based cache wrapper for MIM Neo4j queries."""

    # Cache TTL (Time To Live) in seconds
    TTL_SHORT = 300  # 5 minutes - for search results
    TTL_MEDIUM = 1800  # 30 minutes - for class details
    TTL_LONG = 3600  # 1 hour - for tree structures
    TTL_STATIC = 86400  # 24 hours - for rarely changing data (stats, relationships)

    @staticmethod
    def _make_key(prefix: str, *args, **kwargs) -> str:
        """Generate cache key from function arguments"""
        # Create deterministic key from arguments
        key_data = {
            'args': args,
            'kwargs': sorted(kwargs.items())
        }
        key_hash = hashlib.md5(json.dumps(key_data, sort_keys=True).encode(), usedforsecurity=False).hexdigest()
        return f"mim:{prefix}:{key_hash}"

    @staticmethod
    def cached(prefix: str, ttl: int = TTL_MEDIUM):
        """
        Decorator for caching function results in Redis

        Usage:
            @MIMCache.cached('class_detail', ttl=MIMCache.TTL_LONG)
            def get_class_detail(self, class_name):
                # expensive query...
                return result
        """
        def decorator(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                # Skip caching if DEBUG mode
                if getattr(settings, 'DEBUG', False) and not getattr(settings, 'CACHE_IN_DEBUG', False):
                    return func(*args, **kwargs)

                # Generate cache key
                cache_key = MIMCache._make_key(prefix, *args[1:], **kwargs)  # Skip 'self' arg

                # Try to get from cache
                cached_value = cache.get(cache_key)
                if cached_value is not None:
                    return cached_value

                # Cache miss - execute function
                result = func(*args, **kwargs)

                # Store in cache
                if result is not None:  # Don't cache None results
                    cache.set(cache_key, result, ttl)

                return result
            return wrapper
        return decorator

    @staticmethod
    def invalidate(prefix: str, *args, **kwargs):
        """Invalidate specific cache entry"""
        cache_key = MIMCache._make_key(prefix, *args, **kwargs)
        cache.delete(cache_key)

    @staticmethod
    def invalidate_pattern(pattern: str):
        """
        Invalidate all cache entries matching pattern
        Note: Requires Redis backend with delete_pattern support
        """
        try:
            cache.delete_pattern(f"mim:{pattern}:*")
        except AttributeError:
            # Fallback: clear entire cache if delete_pattern not available
            cache.clear()

    @staticmethod
    def get_stats() -> dict:
        """Get cache statistics (if supported by backend)"""
        try:
            # This works with django-redis backend
            return {
                'backend': cache.__class__.__name__,
                'location': getattr(cache, '_server', 'unknown'),
            }
        except Exception:
            return {}


# Convenience functions for common cache operations
def cache_class_detail(class_name: str, data: dict, ttl: int = MIMCache.TTL_LONG):
    """Cache class detail data"""
    cache_key = MIMCache._make_key('class_detail', class_name)
    cache.set(cache_key, data, ttl)


def get_cached_class_detail(class_name: str):
    """Get cached class detail"""
    cache_key = MIMCache._make_key('class_detail', class_name)
    return cache.get(cache_key)


def cache_relationships(class_name: str, data: dict, ttl: int = MIMCache.TTL_STATIC):
    """Cache class relationships (rarely change)"""
    cache_key = MIMCache._make_key('relationships', class_name)
    cache.set(cache_key, data, ttl)


def get_cached_relationships(class_name: str):
    """Get cached relationships"""
    cache_key = MIMCache._make_key('relationships', class_name)
    return cache.get(cache_key)


def invalidate_class_cache(class_name: str):
    """Invalidate all cache entries for a specific class"""
    MIMCache.invalidate('class_detail', class_name)
    MIMCache.invalidate('relationships', class_name)
    MIMCache.invalidate('properties', class_name)
