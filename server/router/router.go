package router

import (
	"github.com/go-chi/chi"
	"github.com/go-chi/cors"
	"github.com/porter-dev/porter/server/api"
	"github.com/porter-dev/porter/server/requestlog"
	"github.com/porter-dev/porter/server/router/middleware"

	sessionstore "github.com/porter-dev/porter/internal/auth"
)

// New creates a new Chi router instance
func New(a *api.App, store *sessionstore.PGStore, cookieName string) *chi.Mux {
	l := a.Logger()
	r := chi.NewRouter()
	auth := middleware.NewAuth(store, cookieName)

	r.Route("/api", func(r chi.Router) {
		r.Use(middleware.ContentTypeJSON)

		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   []string{"*"},
			AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
			ExposedHeaders:   []string{"Link"},
			AllowCredentials: false,
			MaxAge:           300, // Maximum value not ignored by any of major browsers
		}))

		// /api/users routes
		r.Method("GET", "/users/{id}", auth.DoesUserIDMatch(requestlog.NewHandler(a.HandleReadUser, l)))
		r.Method("GET", "/users/{id}/clusters", auth.DoesUserIDMatch(requestlog.NewHandler(a.HandleReadUserClusters, l)))
		r.Method("GET", "/users/{id}/clusters/all", auth.DoesUserIDMatch(requestlog.NewHandler(a.HandleReadUserClustersAll, l)))
		r.Method("POST", "/users", requestlog.NewHandler(a.HandleCreateUser, l))
		r.Method("PUT", "/users/{id}", auth.DoesUserIDMatch(requestlog.NewHandler(a.HandleUpdateUser, l)))
		r.Method("DELETE", "/users/{id}", auth.DoesUserIDMatch(requestlog.NewHandler(a.HandleDeleteUser, l)))
		r.Method("POST", "/login", requestlog.NewHandler(a.HandleLoginUser, l))
		r.Method("GET", "/auth/check", requestlog.NewHandler(a.HandleAuthCheck, l))
	})

	return r
}
