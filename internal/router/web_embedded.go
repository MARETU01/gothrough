//go:build embedweb

package router

import (
	"github.com/MARETU01/gothrough/internal/webassets"
	"github.com/gin-gonic/gin"
)

func setupWeb(r *gin.Engine) { r.NoRoute(webHandler(webassets.Assets())) }
