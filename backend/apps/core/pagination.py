from rest_framework.pagination import PageNumberPagination


class DefaultPagination(PageNumberPagination):
    """Page size the client can raise, capped so a bad ?limit can't dump the table."""

    page_size = 200
    page_size_query_param = "limit"
    max_page_size = 1000
