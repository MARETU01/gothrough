package main

import "github.com/gin-gonic/gin"

func main() {
	c := gin.Default()
	err := c.Run(":8080")
	if err != nil {
		return
	}
}
